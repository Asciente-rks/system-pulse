import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import type { Organization } from "../types/organization.js";

const ORG_PK = "ORG";
const ORG_SK_PREFIX = "ORG#";
const ENTITY_TYPE = "ORG";

interface OrgRecord extends Organization {
  PK: string;
  SK: string;
  entityType: string;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "org";

export const createOrganizationService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => {
  const getOrganization = async (
    orgId: string,
  ): Promise<Organization | null> => {
    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: ORG_PK, SK: `${ORG_SK_PREFIX}${orgId}` },
      }),
    );
    return (response.Item as Organization | undefined) || null;
  };

  return {
    getOrganization,

    async createOrganization(input: {
      name: string;
      ownerId: string;
      isDemo?: boolean;
      explicitId?: string;
    }): Promise<Organization> {
      const id = input.explicitId || uuidv4();
      const createDate = new Date().toISOString();

      const org: Organization = {
        id,
        name: input.name,
        ownerId: input.ownerId,
        createDate,
        slug: slugify(input.name),
        isDemo: Boolean(input.isDemo),
      };

      const record: OrgRecord = {
        ...org,
        PK: ORG_PK,
        SK: `${ORG_SK_PREFIX}${id}`,
        entityType: ENTITY_TYPE,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      return org;
    },
  };
};
