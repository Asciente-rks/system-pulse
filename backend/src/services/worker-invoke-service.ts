import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { HealthCheckQueueMessage } from "../types/health-events.js";

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

export const invokeHealthWorker = async (
  message: HealthCheckQueueMessage,
): Promise<void> => {
  const functionName = process.env.HEALTH_WORKER_FUNCTION_NAME;

  if (!functionName) {
    throw new Error(
      "HEALTH_WORKER_FUNCTION_NAME environment variable is not set",
    );
  }

  // Reuse the existing SQS worker handler contract with a synthetic single-record event.
  const payload = {
    Records: [
      {
        messageId: `manual-${message.systemId}-${Date.now()}`,
        body: JSON.stringify(message),
      },
    ],
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
};
