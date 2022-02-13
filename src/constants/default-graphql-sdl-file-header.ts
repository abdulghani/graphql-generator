import { PACKAGE_INFO } from "./package-info";

const DEFAULT_GRAPHQL_SDL_FILE_HEADER = `
#
# -------------------------------------------------------
# THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
# npm i -D @adgstudio/graphql-generator (version ${
  PACKAGE_INFO.version ?? "0.0.0"
})
# -------------------------------------------------------
#
`.trim();

export default DEFAULT_GRAPHQL_SDL_FILE_HEADER;
