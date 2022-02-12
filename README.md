## Graphql Generator

Generate graphql object, type definition and merge sdl from graphql sdl/s

### Install

install from npm

```
npm install -D @adgstudio/graphql-generator
```

### Usage

#### Generate Graphql Types

Generate graphql typescript types from graphql sdl file

```typescript
import { GraphqlTypesGenerator } from "@adgstudio/graphql-generator";

async function main() {
  const generator = new GraphqlTypesGenerator();
  await factory.generate("./src/**/*.graphql", {
    outputPath: "path/to/destination.ts",
  });
}

main();
```

#### Generate Graphql Object

Generate graphql object definition from graphql sdl file

```typescript
import { GraphqlObjectGenerator } from "@adgstudio/graphql-generator";

async function main() {
  const generator = new GraphqlObjectGenerator();
  await generator.generate("./src/modules/**/*.graphql", {
    outputPath: "path/to/destination.ts",
  });
}

main();
```

#### Merge graphql sdl to a single file

Merge multiple graphql sdl files to a single graphql sdl file

```typescript
import { GraphqlSdlFactory } from "@adgstudio/graphql-generator";

async function main() {
  const generator = new GraphqlSdlFactory();
  await generator.merge("./src/modules/**/*.graphql", {
    outputPath: "path/to/destination.graphql",
  });
}

main();
```

### Contributing

Fork this repo and create pull request to `dev` branch

### Support

Follow [twitter](https://twitter.com/itsabdulghani), and [youtube](https://www.youtube.com/abdulghani0).
