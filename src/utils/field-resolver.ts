import * as graphql from "graphql";
import { isObjectLike, upperFirst } from "lodash";
import { toEntityResolverName } from "./to-entity-resolver-name";

export const FieldResolver: graphql.GraphQLFieldResolver<unknown, unknown> =
  function (source: any, args, context: any, info) {
    if (isObjectLike(source) || typeof source === "function") {
      const fieldName = info.fieldName;
      const entityResolverName = toEntityResolverName(
        (info.returnType as any).name
      );
      const property = source?.[fieldName];
      const entityResolver = context?.entityResolver?.[entityResolverName];

      if (typeof property === "function") {
        return source[fieldName](source, args, context, info);
      }
      if (!property && typeof entityResolver === "function") {
        return context.entityResolver[entityResolverName](
          source,
          args,
          context,
          info
        );
      }
      return property;
    }
  };
