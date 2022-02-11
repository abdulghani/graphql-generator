import { readFileSync, writeFileSync } from "fs";
import {
  ConstValueNode,
  DefinitionNode,
  DocumentNode,
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
import { Project, SourceFile, VariableDeclarationKind } from "ts-morph";
import DEFAULT_GENERATED_FILE_HEADER from "./constants/default-generated-file-header";
import IMPORT_GRAPHQL_HEADER from "./constants/import-graphql-header";

declare interface Config {
  outputPath: string;
  emitResolverFunctions?: boolean;
  tsConfigPath?: string;
  objectDeclarationOrder?: Kind[];
  fileHeader?: string;
}

const DEFAULT_OBJECT_DECLARATION_ORDER: Kind[] = [
  Kind.SCALAR_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
];

class GraphqlObjectFactory {
  private tsMorphLib!: typeof import("ts-morph");
  private tsProject!: Project;
  private tsFile!: SourceFile;
  private config!: Config;
  private objectList!: string[];

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

  private async generateFile(config: Config) {
    this.assignConfig(config);
    await this.createTsProject(config);

    this.tsFile = this.tsProject.createSourceFile(config.outputPath, "", {
      overwrite: true,
    });
    this.objectList = [];

    return this.tsFile;
  }

  private assignConfig(config: Config) {
    this.config = config;
  }

  private getSdlDefinitions(graphqlSdl: DocumentNode, config: Config) {
    const definitions = lodash.cloneDeep(
      graphqlSdl.definitions
    ) as DefinitionNode[];

    const declarationOrder =
      config.objectDeclarationOrder ?? DEFAULT_OBJECT_DECLARATION_ORDER;

    const sorted = definitions.sort((a, b) => {
      const [kindA, kindB] = [
        declarationOrder.indexOf(a.kind),
        declarationOrder.indexOf(b.kind),
      ];
      if (kindA != kindB) return kindA - kindB;
      const [nameA, nameB]: string[] = [
        lodash.get(a, "name.value", ""),
        lodash.get(b, "name.value", ""),
      ];

      return nameA.localeCompare(nameB);
    });

    return sorted;
  }

  private traverseDefinitions(definitions: DefinitionNode[]) {
    definitions.forEach((item) => {
      const objectName = lodash.get(item, "name.value", undefined);
      if (objectName) this.objectList.push(objectName);

      this.handleDefinitionType(item);
    });
  }

  private handleDefinitionType(def: DefinitionNode) {
    switch (def.kind) {
      case "SchemaDefinition":
        break;
      case "ObjectTypeDefinition":
        return this.createGraphqlObject(def);
      case "ObjectTypeExtension":
        break;
      case "InputObjectTypeDefinition":
        return this.createGraphQLInput(def);
      case "InputObjectTypeExtension":
        break;
      case "InterfaceTypeDefinition":
        return this.createGraphQLInterface(def);
      case "InterfaceTypeExtension":
        break;
      case "ScalarTypeDefinition":
        return this.createGraphqlScalar(def);
      case "ScalarTypeExtension":
        break;
      case "EnumTypeDefinition":
        return this.createGraphqlEnum(def);
      case "EnumTypeExtension":
        break;
      case "UnionTypeDefinition":
        return this.createGraphqlUnion(def);
      case "UnionTypeExtension":
        break;
    }
  }

  private createGraphqlObject(def: ObjectTypeDefinitionNode) {
    this.tsFile.addVariableStatement({
      leadingTrivia: (w) => w.writeLine("\n"),
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLObjectType(${this.buildObjectDeclaration(
            {
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value) {
                  return `"${def.description.value}"`;
                }
                return undefined;
              })(),
              interfaces: (() => {
                if (!def.interfaces?.length) return undefined;
                return `[${def.interfaces
                  ?.map((item) => item.name.value)
                  .join(",")}]`;
              })(),
              fields: (() => {
                if (!def.fields?.length) {
                  return undefined;
                }
                return `${this.buildGraphqlObjectFields(def.fields, def)}`;
              })(),
            }
          )})`,
        },
      ],
    });
  }

  private createGraphQLInput(def: InputObjectTypeDefinitionNode) {
    this.tsFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      leadingTrivia: (w) => w.writeLine("\n"),
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLInputObjectType(
            ${this.buildObjectDeclaration({
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value) {
                  return `"${def.description.value}"`;
                }
                return undefined;
              })(),
              fields: this.buildGraphqlInputFields(def.fields),
            })})`,
        },
      ],
    });
  }

  private createGraphQLInterface(def: InterfaceTypeDefinitionNode) {
    this.tsFile.addVariableStatement({
      leadingTrivia: (w) => w.writeLine("\n"),
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLInterfaceType(${this.buildObjectDeclaration(
            {
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value) {
                  return `"${def.description.value}"`;
                }
                return undefined;
              })(),
              fields: `${this.buildGraphqlObjectFields(def.fields, def)}`,
            }
          )})`,
        },
      ],
    });
  }

  private createGraphqlScalar(def: ScalarTypeDefinitionNode) {
    this.tsFile.addVariableStatement({
      leadingTrivia: (w) => w.writeLine("\n"),
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLScalarType(${this.buildObjectDeclaration(
            {
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value) {
                  return `"${def.description.value}"`;
                }
                return undefined;
              })(),
            }
          )})`,
        },
      ],
    });
  }

  private createGraphqlEnum(def: EnumTypeDefinitionNode) {
    this.tsFile.addVariableStatement({
      leadingTrivia: (w) => w.writeLine("\n"),
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLEnumType(${this.buildObjectDeclaration(
            {
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value) {
                  return `"${def.description.value}"`;
                }
                return undefined;
              })(),
              values: this.buildObjectDeclaration(
                def.values?.reduce((total: any, item) => {
                  total[item.name.value] = this.buildObjectDeclaration({
                    value: `"${item.name.value}"`,
                  });
                  return total;
                }, {})
              ),
            }
          )})`,
        },
      ],
    });
  }

  private createGraphqlUnion(def: UnionTypeDefinitionNode) {
    const validTypes =
      def.types?.filter((item) => this.objectList.includes(item.name.value)) ??
      [];

    if (validTypes.length !== def.types?.length) {
      throw new Error(
        `INVALID TYPES FOR UNION (${def.types
          ?.filter((item) => !this.objectList.includes(item.name.value))
          .map((item) => item.name.value)
          .join(", ")})`
      );
    }

    this.tsFile.addVariableStatement({
      leadingTrivia: (w) => w.writeLine("\n"),
      declarationKind: VariableDeclarationKind.Const,
      isExported: true,
      declarations: [
        {
          name: def.name.value,
          initializer: `new graphql.GraphQLUnionType(${this.buildObjectDeclaration(
            {
              name: `"${def.name.value}"`,
              description: (() => {
                if (def.description?.value)
                  return `"${def.description?.value}"`;
                return undefined;
              })(),
              types: `[${validTypes.map((item) => item.name.value)}]`,
            }
          )})`,
        },
      ],
    });
  }

  private buildObjectDeclaration(obj: any) {
    return `{${Object.keys(obj)
      .reduce((total: any, key) => {
        if (obj[key]) {
          total.push(`"${key}": ${obj[key]}`);
        }
        return total;
      }, [])
      .join(",")}}`;
  }

  private buildGraphqlObjectFields(
    fields?: readonly FieldDefinitionNode[],
    parent?: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode
  ) {
    const declaration: any = {};
    fields?.forEach?.((item) => {
      declaration[item.name.value] = this.buildObjectDeclaration({
        type: `${this.handleGraphqlType(item.type)}`,
        description: (() => {
          if (item.description?.value) {
            return `"${item.description.value}"`;
          }
          return undefined;
        })(),
        args: (() => {
          if (item.arguments?.length) {
            return `{${item.arguments.map((argItem) => {
              const argDeclaration = {
                type: this.handleGraphqlType(argItem.type),
              };
              return `"${argItem.name.value}": ${this.buildObjectDeclaration(
                argDeclaration
              )}`;
            })}}`;
          }

          return undefined;
        })(),
        resolve: (() => {
          const isQueryMutation = ["query", "mutation"]?.includes?.(
            (parent?.name?.value ?? "")?.toLowerCase?.()
          );
          if (
            this.config.emitResolverFunctions &&
            (isQueryMutation || item.arguments?.length)
          ) {
            return `function (source, args, context, info) {}`;
          }
          return undefined;
        })(),
      });
    });

    return this.buildObjectDeclaration(declaration);
  }

  private buildGraphqlInputFields(
    fields?: readonly InputValueDefinitionNode[]
  ) {
    const declaration: any = {};
    fields?.forEach?.((item) => {
      declaration[item.name.value] = this.buildObjectDeclaration({
        type: `${this.handleGraphqlType(item.type)}`,
        description: (() => {
          if (item.description?.value) {
            return `"${item.description.value}"`;
          }
          return undefined;
        })(),
        defaultValue: (() => {
          if (item.defaultValue) {
            return `${this.handleGraphqlValue(item.defaultValue)}`;
          }
          return undefined;
        })(),
      });
    });

    return this.buildObjectDeclaration(declaration);
  }

  private handleGraphqlType(node: TypeNode): string {
    switch (node.kind) {
      case Kind.NON_NULL_TYPE:
        return `new graphql.GraphQLNonNull(${this.handleGraphqlType(
          node.type
        )})`;
      case Kind.LIST_TYPE:
        return `new graphql.GraphQLList(${this.handleGraphqlType(node.type)})`;
      case Kind.NAMED_TYPE:
        return `${this.handleNamedType(node)}`;
    }
  }

  private handleGraphqlValue(node: ConstValueNode): string {
    switch (node.kind) {
      case Kind.STRING:
      case Kind.ENUM:
        return `"${node.value}"`;
      case Kind.INT:
      case Kind.FLOAT:
      case Kind.BOOLEAN:
        return `${node.value}`;
      case Kind.LIST:
        return `[ ${node.values.map((item) =>
          this.handleGraphqlValue(item)
        )} ]`;

      default:
        throw new Error(`GraphqlValue unhandled (${node.kind})`);
    }
  }

  private handleNamedType(node: NamedTypeNode): string {
    switch (node.name.value) {
      case "String":
        return `graphql.GraphQLString`;
      case "Boolean":
        return `graphql.GraphQLBoolean`;
      case "Float":
        return `graphql.GraphQLFloat`;
      case "Int":
        return `graphql.GraphQLInt`;
      default:
        // SCALAR, ENUM GOES HERE
        if (!this.objectList.includes(node.name.value)) {
          throw new Error(`INVALID TYPE DEFINITION (${node.name.value})`);
        }
        return node.name.value;
    }
  }

  private addFileHeader(file: SourceFile, config: Config) {
    const headers = [
      config?.fileHeader ?? DEFAULT_GENERATED_FILE_HEADER,
      IMPORT_GRAPHQL_HEADER,
    ];
    file.insertText(0, headers.join("\n"));
  }

  private async formatFile(config: Config) {
    const file = readFileSync(config.outputPath, { encoding: "utf-8" });
    const formatted = prettier.format(file, { parser: "typescript" });

    writeFileSync(config.outputPath, formatted, { encoding: "utf-8" });

    return this.tsFile;
  }

  private async end(config: Config) {
    await this.tsFile.save();
    await this.formatFile(config);

    return this.tsFile;
  }

  public async generateGraphqlObject(graphqlSdl: DocumentNode, config: Config) {
    const file = await this.generateFile(config);
    const definitions = this.getSdlDefinitions(graphqlSdl, config);

    this.addFileHeader(file, config);
    this.traverseDefinitions(definitions);

    // THIS HAS TO GO LAST
    return this.end(config);
  }
}
