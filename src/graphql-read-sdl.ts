import { mergeTypeDefs } from "@graphql-tools/merge";
import fastGlob from "fast-glob";
import { readFile } from "fs/promises";
import lodash from "lodash";

interface Config {
  glob: string | string[];
  ignorePaths?: string | string[];
  mergeSdl?: boolean;
}

interface SdlItem {
  sdl: string;
  path?: string;
}

class GraphqlSdlReader {
  private getIgnoreList(config: Config): string[] {
    if (Array.isArray(config.ignorePaths)) {
      return config.ignorePaths;
    }
    if (config.ignorePaths && config.ignorePaths?.trim?.() !== "") {
      return [config.ignorePaths];
    }
    return [];
  }

  public async readSdls(config: Config): Promise<SdlItem[]> {
    const ignoreList = this.getIgnoreList(config);
    const entries = await fastGlob(config.glob, { ignore: ignoreList });
    const files = await Promise.all(
      entries.map((item) => readFile(item, { encoding: "utf-8" }))
    );

    if (config.mergeSdl === false) {
      return files.map((item, i) => ({
        sdl: item,
        path: entries[i],
      }));
    }

    const flattenFiles = lodash.flatten(files);
    const merged = mergeTypeDefs(flattenFiles, {
      throwOnConflict: true,
      commentDescriptions: true,
      reverseDirectives: true,
      sort: true,
    });

    return [
      {
        sdl: merged,
      },
    ];
  }
}

export default GraphqlSdlReader;
