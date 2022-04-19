import { upperFirst } from "lodash";

export function toEntityResolverName(entityName: string) {
  return `resolve` + upperFirst(entityName);
}
