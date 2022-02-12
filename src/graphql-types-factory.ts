import { mergeTypeDefs } from "@graphql-tools/merge";
import { gql } from "apollo-server-core";
import fastGlob from "fast-glob";
import { readFile, writeFile } from "fs/promises";
import {
  DefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  Kind,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ScalarTypeDefinitionNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from "graphql";
import lodash from "lodash";
import path from "path";
import prettier from "prettier";
import {
  InterfaceDeclaration,
  OptionalKind,
  ParameterDeclarationStructure,
  Project,
  SourceFile,
} from "ts-morph";
import IMPORT_GRAPHQL_HEADER from "./constants/import-graphql-header";

interface Config {
  outputPath: string;
  tsConfigPath?: string;
}

export class GraphqlTypesFactory {
  private tsMorphLib!: typeof import("ts-morph");
  private tsProject!: Project;
  private tsFile!: SourceFile;
  private config!: Config;
  private typeList!: string[];

  private addNullable() {
    this.tsFile.addTypeAlias({
      name: "Nullable",
      typeParameters: ["T"],
      isExported: true,
      type: `T | null | undefined`,
    });
  }

  private addHeader() {
    this.tsFile.insertText(0, [IMPORT_GRAPHQL_HEADER].join("\n"));
  }

  private assignConfig(config: Config) {
    this.config = config;
    this.typeList = [];
    return this.config;
  }

  private async createTsProject(config: Config) {
    this.tsMorphLib = await import("ts-morph");
    this.tsProject = new this.tsMorphLib.Project({
      tsConfigFilePath:
        config.tsConfigPath ?? path.join(process.cwd(), "./tsconfig.json"),
      manipulationSettings: {
        newLineKind: this.tsMorphLib.NewLineKind.LineFeed,
      },
    });

    return this.tsProject;
  }

  private async createFile(config: Config) {
    this.assignConfig(config);
    await this.createTsProject(config);

    this.tsFile = this.tsProject.createSourceFile(config.outputPath, "", {
      overwrite: true,
    });
    this.addHeader();
    this.addNullable();

    return this.tsFile;
  }

  private async formatFile(config: Config) {
    const file = await readFile(config.outputPath, { encoding: "utf-8" });
    await writeFile(
      config.outputPath,
      prettier.format(file, { parser: "typescript" }),
      {
        encoding: "utf-8",
      }
    );

    return this.tsFile;
  }

  private async end(config: Config) {
    await this.tsFile.save();
    await this.formatFile(config);

    return this.tsFile;
  }

  private getSdlDefinitions(graphqlSdl: string) {
    const documentNodes = gql(graphqlSdl);
    const definitions = lodash.cloneDeep(
      documentNodes.definitions
    ) as DefinitionNode[];
    return lodash.sortBy(definitions, ["kind", "name.value"]);
  }

  private addResolverType() {
    const list = ["query", "mutation"];
    const resolvedTypes = this.typeList
      .filter((item) => list.includes(item?.toLowerCase?.()))
      ?.map((item) => `Omit<${item}, "__typename">`);

    if (resolvedTypes.length) {
      this.tsFile.addTypeAlias({
        name: "Resolver",
        leadingTrivia: (w) => w.writeLine("\n"),
        isExported: true,
        type: resolvedTypes.join(" & "),
      });
    }
  }

  private traverseDefinitions(defs: DefinitionNode[]) {
    defs.forEach((item) => {
      this.typeList.push(lodash.get(item, "name.value", ""));
      this.handleDefinitionKind(item);
    });
  }

  private handleDefinitionKind(node: DefinitionNode) {
    switch (node.kind) {
      case Kind.SCHEMA_DEFINITION:
        break;
      case Kind.OBJECT_TYPE_DEFINITION:
        return this.createObjectInterface(node);
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        return this.createInputInterface(node);
      case Kind.INTERFACE_TYPE_DEFINITION:
        return this.createInterfaceInterface(node);
      case Kind.SCALAR_TYPE_DEFINITION:
        return this.createScalarInterface(node);
      case Kind.ENUM_TYPE_DEFINITION:
        return this.createEnumInterface(node);
      case Kind.UNION_TYPE_DEFINITION:
        return this.createUnionInterface(node);
      default:
        return console.warn(`Definition kind is not handled (${node.kind})`);
    }
  }

  private createInterfaceInterface(node: InterfaceTypeDefinitionNode) {
    const intr = this.tsFile.addInterface({
      trailingTrivia: (w) => w.writeLine("\n"),
      name: node.name.value,
      isExported: true,
      kind: this.tsMorphLib.StructureKind.Interface,
    });

    // FIELDS
    node.fields?.forEach((item) => {
      intr.addProperty({
        name: item.name.value,
        type: this.handleInputValueNode(item.type),
        hasQuestionToken: item.type.kind !== Kind.NON_NULL_TYPE,
      });
    });
  }

  private createUnionInterface(node: UnionTypeDefinitionNode) {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: node.name.value,
      isExported: true,
      type:
        node.types
          ?.map((item) =>
            this.handleNamedTypeNode(item, { ignoreNullable: true })
          )
          .join(" | ") ?? "",
    });
  }

  private createObjectInterface(node: ObjectTypeDefinitionNode) {
    const intr = this.tsFile.addInterface({
      name: node.name.value,
      isExported: true,
      kind: this.tsMorphLib.StructureKind.Interface,
      extends: node.interfaces?.map((item) => item.name.value) ?? [],
    });

    intr.addProperty({
      name: "__typename",
      type: `"${node.name.value}"`,
      hasQuestionToken: true,
    });
    const sortedMember = lodash.sortBy(node.fields ?? [], ["name.value"]);
    sortedMember?.forEach((item) => {
      this.addObjectMember(item, intr);
    });
  }

  private sortMethodArguments(nodes: readonly InputValueDefinitionNode[]) {
    // SORT OPTIONAL ARGUMENTS LAST
    return lodash
      .cloneDeep<InputValueDefinitionNode[]>((nodes ?? []) as any)
      .sort(
        (a, b) =>
          Number(a.type.kind !== Kind.NON_NULL_TYPE) -
          Number(b.type.kind !== Kind.NON_NULL_TYPE)
      );
  }

  private addMethodArg(
    nodes: InputValueDefinitionNode[],
    parent: FieldDefinitionNode
  ) {
    const argIntr = this.tsFile.addInterface({
      name: lodash.upperFirst(lodash.camelCase(`${parent.name.value} Args`)),
      isExported: true,
      kind: this.tsMorphLib.StructureKind.Interface,
    });

    nodes.forEach((item) => {
      argIntr.addProperty({
        name: item.name.value,
        type: this.handleInputValueNode(item.type),
        hasQuestionToken: item.type.kind !== Kind.NON_NULL_TYPE,
      });
    });

    return argIntr;
  }

  private addObjectMember(
    node: FieldDefinitionNode,
    parent: InterfaceDeclaration
  ) {
    if (node.arguments?.length) {
      const sorted = this.sortMethodArguments(node.arguments);
      const argIntr = this.addMethodArg(sorted, node);

      // RESOLVER ARG, CONTEXT, INFO
      const resolverArgs: OptionalKind<ParameterDeclarationStructure>[] = [
        { name: "args", type: argIntr.getName(), hasQuestionToken: false },
        { name: "context", type: "any", hasQuestionToken: false },
        {
          name: "info",
          type: "graphql.GraphQLResolveInfo",
          hasQuestionToken: false,
        },
      ];

      return parent.addMethod({
        name: node.name.value,
        parameters: resolverArgs,
        hasQuestionToken: false,
        returnType: this.handleInputValueNode(node.type, { promise: true }),
      });

      // HANDLE QUERY/MUTATION METHODS ALL RESOLVER
    } else if (["query", "mutation"].includes(parent.getName().toLowerCase())) {
      return parent.addMethod({
        name: node.name.value,
        hasQuestionToken: false,
        parameters: [],
        returnType: this.handleInputValueNode(node.type, { promise: true }),
      });
    }
    return parent.addProperty({
      name: node.name.value,
      type: this.handleInputValueNode(node.type),
      hasQuestionToken: false,
    });
  }

  private createEnumInterface(node: EnumTypeDefinitionNode) {
    this.tsFile.addEnum({
      name: node.name.value,
      isExported: true,
      members:
        node.values?.map((item) => {
          return {
            name: item.name.value,
            value: item.name.value,
          };
        }) ?? [],
    });
  }

  private createScalarInterface(node: ScalarTypeDefinitionNode) {
    this.tsFile.addTypeAlias({
      name: node.name.value,
      isExported: true,
      type: `any`,
    });
  }

  private createInputInterface(node: InputObjectTypeDefinitionNode) {
    const intr = this.tsFile.addInterface({
      trailingTrivia: (w) => w.writeLine("\n"),
      name: node.name.value,
      isExported: true,
      kind: this.tsMorphLib.StructureKind.Interface,
    });

    // FIELDS
    node.fields?.forEach((item) => {
      intr.addProperty({
        name: item.name.value,
        type: this.handleInputValueNode(item.type),
        hasQuestionToken: item.type.kind !== Kind.NON_NULL_TYPE,
      });
    });
  }

  private handleInputValueNode(
    node: TypeNode,
    options?: { promise?: boolean; ignoreNullable?: boolean }
  ): string {
    const { promise, ignoreNullable } = options ?? {};
    let str: string;

    switch (node.kind) {
      case Kind.NON_NULL_TYPE:
        str = `${this.handleInputValueNode(node.type, {
          ignoreNullable: true,
        })}`;
        break;
      case Kind.LIST_TYPE:
        str = `Array<${this.handleInputValueNode(node.type)}>`;
        break;
      case Kind.NAMED_TYPE:
        str = this.handleNamedTypeNode(node, { ignoreNullable });
        break;
    }

    if (promise) {
      return `${str} | Promise<${str}>`;
    }

    return str;
  }

  private handleNamedTypeNode(
    node: NamedTypeNode,
    options?: { ignoreNullable?: boolean }
  ) {
    const { ignoreNullable } = options ?? {};
    let str: string;
    switch (node.name.value) {
      case "String":
        str = `string`;
        break;
      case "Boolean":
        str = `boolean`;
        break;
      case "Float":
      case "Int":
        str = `number`;
        break;
      default:
        // SCALAR, ENUM GOES HERE
        // if (!this.typeList.includes(node.name.value)) {
        //   throw new Error(`INVALID TYPE DEFINITION (${node.name.value})`);
        // }
        str = `${node.name.value}`;
        break;
    }

    if (ignoreNullable) {
      return str;
    }

    return `Nullable<${str}>`;
  }

  public async generate(graphqlSdl: string, config: Config) {
    const tsFile = await this.createFile(config);
    const definitions = this.getSdlDefinitions(graphqlSdl);
    this.traverseDefinitions(definitions);
    this.addResolverType();

    // THIS HAS TO BE THE END
    return this.end(config);
  }
}

interface GeneratorConfig extends Omit<Config, "outputPath"> {
  ignorePaths?: string[];
  outputPath?: string;
}

export class GraphqlTypesGenerator {
  private mergeSdl(sdls: string | string[]) {
    return mergeTypeDefs(sdls, {
      throwOnConflict: true,
      commentDescriptions: true,
      sort: true,
      consistentEnumMerge: true,
      ignoreFieldConflicts: false,
    });
  }

  public async generate(
    globPaths: string | string[],
    config?: GeneratorConfig
  ) {
    config = config ?? {};
    const entries = await fastGlob(globPaths, { ignore: config.ignorePaths });
    const files = await Promise.all(
      entries.map((item) => readFile(item, { encoding: "utf-8" }))
    );

    if (!config.outputPath) {
      return await Promise.all(
        files.map(async (item, i) => {
          console.log(`GENERATING TYPES FROM (${entries[i]})`);
          const sdl = this.mergeSdl(item);
          const outputPath = entries[i] + ".types.ts";
          const factory = new GraphqlTypesFactory();
          await factory.generate(sdl, { ...config, outputPath });
          console.log(`CREATED GRAPHQL TYPES FILE (${outputPath})`);
        })
      );
    }

    return await (async () => {
      console.log("MERGING TYPES FROM", entries);
      const sdl = this.mergeSdl(files);
      const factory = new GraphqlTypesFactory();
      await factory.generate(sdl, {
        ...config,
        outputPath: config.outputPath!,
      });
      console.log(`CREATED GRAPHQL TYPES FILE (${config.outputPath})`);
    })();
  }
}
