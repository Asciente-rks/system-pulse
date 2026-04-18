import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import config from "./config.js";

// 1. Detect Environment
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const isLocal = process.env.IS_OFFLINE === "true" || !isLambda;

const { region, accessKeyId, secretAccessKey } = config.aws_production;

const clientConfig: any = {
  region: region || "ap-southeast-1",
};

// 2. The Switch Logic
if (isLocal) {
  // Point to your local "Serverless Offline" database
  clientConfig.endpoint = "http://localhost:8000";
  clientConfig.credentials = {
    accessKeyId: "localKey",
    secretAccessKey: "localSecret",
  };
} else {
  // In Lambda, we only use credentials if they are provided (for non-execution role testing)
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }
}

const client = new DynamoDBClient(clientConfig);

// 3. The Modern Translator
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});
