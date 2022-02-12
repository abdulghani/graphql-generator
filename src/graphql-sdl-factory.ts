import { mergeTypeDefs } from "@graphql-tools/merge";
import FastGlob from "fast-glob";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import prettier from "prettier";

interface Config {
  outputPath: string;
  ignorePaths?: string[];
}

export class GraphqlSdlFactory {
  public async merge(globPaths: string | string[], config: Config) {
    const entries = await FastGlob(globPaths, { ignore: config.ignorePaths });
    const files = await Promise.all(
      entries.map((item) => readFile(item, { encoding: "utf-8" }))
    );
    console.log("MERGING SDL FILES FROM", entries);

    const merged = mergeTypeDefs(files, {
      throwOnConflict: true,
      commentDescriptions: true,
      sort: true,
      consistentEnumMerge: true,
      ignoreFieldConflicts: false,
    });

    const formatted = prettier.format(merged, { parser: "graphql" });
    await writeFile(path.resolve(config.outputPath), formatted, {
      encoding: "utf-8",
    });
    console.log(`CREATED SDL FILE (${config.outputPath})`);
  }
}
