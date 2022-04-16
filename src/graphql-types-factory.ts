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
  StructureKind,
} from "ts-morph";
import DEFAULT_GENERATED_FILE_HEADER from "./constants/default-generated-file-header";
import DEFAULT_GRAPHQL_CONTEXT_NAME from "./constants/default-graphql-context-name";
import IMPORT_GRAPHQL_HEADER from "./constants/import-graphql-header";
import { toEntityResolverName } from "./utils/to-entity-resolver-name";

interface Config {
  outputPath: string;
  tsConfigPath?: string;
  contextTypePath?: string;
  contextTypeName?: string;
  fileHeader?: string;
}

export class GraphqlTypesFactory {
  private tsMorphLib!: typeof import("ts-morph");
  private tsProject!: Project;
  private tsFile!: SourceFile;
  private config!: Config;
  private typeList!: string[];
  private objectList: string[] = [];

  private getContextTypeName() {
    return this.config.contextTypeName ?? DEFAULT_GRAPHQL_CONTEXT_NAME;
  }

  private addNullableType() {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: "Nullable",
      typeParameters: ["T"],
      isExported: true,
      type: `T | null | undefined`,
    });
  }

  private addPromisable() {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: "Promisable",
      typeParameters: ["T"],
      isExported: true,
      type: `T | Promise<T>`,
    });
  }

  /** UNUSED FOR PUTTING ARGS AS OBJECT
   * WOULD REQUIRE CUSTOM FIELD RESOLVER FUNCTION TO MAP
   */
  private addResolverArgsType() {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: "GraphqlResolverArgs",
      typeParameters: [
        {
          name: "TSource",
          default: "any",
        },
        { name: "TArgs", default: "any" },
      ],
      isExported: true,
      type: `{
        source: TSource,
        args: TArgs,
        context: ${this.getContextTypeName()},
        info: graphql.GraphQLResolveInfo
      }`.trim(),
    });
  }

  private addFieldResolverType() {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: "GraphqlFieldResolver",
      typeParameters: ["TSource", "TArgs", "TResult"],
      isExported: true,
      type: `(
          source: TSource,
          args: TArgs,
          context: ${this.getContextTypeName()},
          info: graphql.GraphQLResolveInfo
        ) => Promisable<TResult>`.trim(),
    });
  }

  private addResolvableType() {
    this.tsFile.addTypeAlias({
      leadingTrivia: (w) => w.writeLine("\n"),
      name: "Resolvable",
      typeParameters: ["TSource", "TResult"],
      isExported: true,
      type: `TResult | GraphqlFieldResolver<TSource, unknown, TResult>`,
    });
  }

  private addContextType() {
    const intrExtends: string[] = [];
    if (this.config.contextTypePath) {
      const targetPath = (() => {
        const _targetPath = path.resolve(this.config.contextTypePath);
        if (_targetPath.match(/\.ts$/i))
          return _targetPath.replace(/\.ts$/i, "");
        return _targetPath;
      })();
      const outputPath = path
        .resolve(this.config.outputPath)
        .split("/")
        .slice(0, -1)
        .join("/");
      const relativePath = (() => {
        const _relativePath = path.relative(outputPath, targetPath);
        if (_relativePath.startsWith(".")) return _relativePath;
        return "./" + _relativePath;
      })();
      const ContextLabel = "IMPORTED_CONTEXT";
      const importTemplate = `import ${ContextLabel} from "${relativePath}";`;
      intrExtends.push(ContextLabel);

      this.tsFile.insertText(0, importTemplate);
    }

    const contextIntr = this.tsFile.addInterface({
      name: this.getContextTypeName(),
      isExported: true,
      extends: intrExtends,
      kind: StructureKind.Interface,
    });

    contextIntr.addProperty({
      name: "entityResolvers",
      type: "EntityResolver",
      hasQuestionToken: false,
    });

    return;
  }

  private addHeader() {
    const header = this.config.fileHeader ?? DEFAULT_GENERATED_FILE_HEADER;
    this.tsFile.insertText(0, [header, IMPORT_GRAPHQL_HEADER].join("\n\n"));
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
    this.addNullableType();
    this.addPromisable();
    this.addContextType();
    this.addHeader();

    this.addFieldResolverType();
    this.addResolvableType();

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

  private getNamedNodeStr(item: TypeNode): string {
    if (item.kind === Kind.NAMED_TYPE) {
      return item.name.value;
    }
    return this.getNamedNodeStr(item.type);
  }

  private getDefinitionNodeDeps(node: DefinitionNode): string[] {
    const deps: string[] = [];
    const fields: FieldDefinitionNode[] = lodash.get(node, "fields", []);
    const interfaces: NamedTypeNode[] = lodash.get(node, "interfaces", []);

    fields.forEach((item) => {
      deps.push(this.getNamedNodeStr(item.type));
      item.arguments?.forEach((aItem) => {
        deps.push(this.getNamedNodeStr(aItem.type));
      });
    });
    interfaces.forEach((item) => {
      deps.push(this.getNamedNodeStr(item));
    });

    return deps;
  }

  private getSdlDefinitions(graphqlSdl: string): DefinitionNode[] {
    const documentNodes = gql(graphqlSdl);
    const definitions = lodash
      .cloneDeep(documentNodes.definitions)
      .map((item) => {
        const name = lodash.get(item, "name.value", "");
        if (name) this.typeList.push(name);

        return {
          name,
          definition: item,
          deps: this.getDefinitionNodeDeps(item),
        };
      });

    const sorted = definitions.sort((a, b) => {
      const [depsA, depsB]: Array<string[]> = [a.deps, b.deps];
      const [nameA, nameB]: string[] = [a.name, b.name];

      if (depsA.includes(nameB) && depsB.includes(nameA))
        throw new Error(
          `Circular dependency between (${nameA}) and (${nameB})`
        );
      if (!depsA.includes(nameB) && !depsB.includes(nameA)) return -1;
      if (depsB.includes(nameA)) return -1;
      if (depsA.includes(nameB)) return 1;

      return 0;
    });

    return sorted.map((item) => item.definition);
  }

  private addResolverType() {
    const list = ["query", "mutation"];
    const resolvedTypes = this.typeList
      .filter((item) => list.includes(item?.toLowerCase?.()))
      ?.map((item) => `Omit<${item}, "__typename">`);

    if (resolvedTypes.length) {
      this.tsFile.addInterface({
        name: "Resolver",
        leadingTrivia: (w) => w.writeLine("\n"),
        extends: resolvedTypes,
        isExported: true,
      });
    }
  }

  private traverseDefinitions(defs: DefinitionNode[]) {
    defs.forEach((item) => {
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

  private addEntityResolverType() {
    const intr = this.tsFile.addInterface({
      name: "EntityResolver",
      isExported: true,
      kind: StructureKind.Interface,
    });

    const params: OptionalKind<ParameterDeclarationStructure>[] = [];
    params.push(
      { name: "source", type: "unknown", hasQuestionToken: false },
      { name: "args", type: "unknown", hasQuestionToken: false },
      {
        name: "context",
        type: this.getContextTypeName(),
        hasQuestionToken: false,
      },
      {
        name: "info",
        type: "graphql.GraphQLResolveInfo",
        hasQuestionToken: false,
      }
    );

    this.objectList.forEach((key) => {
      intr.addMethod({
        name: toEntityResolverName(key),
        hasQuestionToken: true,
        parameters: params,
        returnType: `Promise<${key} | undefined>`,
      });
    });
  }

  private createObjectInterface(node: ObjectTypeDefinitionNode) {
    const intr = this.tsFile.addInterface({
      name: node.name.value,
      isExported: true,
      kind: this.tsMorphLib.StructureKind.Interface,
      extends: node.interfaces?.map((item) => item.name.value) ?? [],
    });
    this.objectList.push(node.name.value);

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
      const resolverArgs: OptionalKind<ParameterDeclarationStructure>[] =
        (() => {
          return [
            { name: "source", type: "unknown", hasQuestionToken: false },
            { name: "args", type: argIntr.getName(), hasQuestionToken: false },
            {
              name: "context",
              type: this.getContextTypeName(),
              hasQuestionToken: false,
            },
            {
              name: "info",
              type: "graphql.GraphQLResolveInfo",
              hasQuestionToken: false,
            },
          ];
        })();

      return parent.addMethod({
        name: node.name.value,
        parameters: resolverArgs,
        hasQuestionToken: false,
        returnType: this.handleInputValueNode(node.type, { isResolver: true }),
      });

      // HANDLE QUERY/MUTATION METHODS ALL RESOLVER
    } else if (["query", "mutation"].includes(parent.getName().toLowerCase())) {
      return parent.addMethod({
        name: node.name.value,
        hasQuestionToken: false,
        parameters: [],
        returnType: this.handleInputValueNode(node.type, { isResolver: true }),
      });
    }
    return parent.addProperty({
      name: node.name.value,
      type: this.handleInputValueNode(node.type, { isProperty: true }),
      hasQuestionToken: node.type.kind !== Kind.NON_NULL_TYPE,
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
    options?: {
      isResolver?: boolean;
      ignoreNullable?: boolean;
      isProperty?: boolean;
    }
  ): string {
    const { isResolver, ignoreNullable, isProperty } = options ?? {};
    let str: string;

    switch (node.kind) {
      case Kind.NON_NULL_TYPE:
        str = `${this.handleInputValueNode(node.type, {
          ignoreNullable: true,
          isProperty,
        })}`;
        break;
      case Kind.LIST_TYPE:
        str = `Array<${this.handleInputValueNode(node.type)}>`;
        break;
      case Kind.NAMED_TYPE:
        str = this.handleNamedTypeNode(node, { ignoreNullable, isProperty });
        break;
    }

    if (isResolver) {
      return `Promisable<${str}>`;
    }

    return str;
  }

  private handleNamedTypeNode(
    node: NamedTypeNode,
    options?: { ignoreNullable?: boolean; isProperty?: boolean }
  ) {
    const { ignoreNullable, isProperty } = options ?? {};
    let str: string;
    let isScalar: boolean = false;

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
        if (!this.typeList.includes(node.name.value)) {
          throw new Error(`INVALID TYPE DEFINITION (${node.name.value})`);
        }
        isScalar = true;
        str = `${node.name.value}`;
        break;
    }

    if (ignoreNullable && isProperty && isScalar) {
      return `Resolvable<this, ${str}>`;
    }
    if (ignoreNullable) {
      return str;
    }
    if (isProperty && isScalar) {
      return `Resolvable<this, Nullable<${str}>>`;
    }

    return `Nullable<${str}>`;
  }

  public async generate(graphqlSdl: string, config: Config) {
    const tsFile = await this.createFile(config);
    const definitions = this.getSdlDefinitions(graphqlSdl);
    this.traverseDefinitions(definitions);
    this.addEntityResolverType();
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
