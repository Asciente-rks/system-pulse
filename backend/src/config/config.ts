import "dotenv/config";

export default {
  aws_production: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? process.env.aws_access_key_id,
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY ?? process.env.aws_secret_access_key,
    region:
      process.env.AWS_REGION ?? process.env.aws_region ?? "ap-southeast-1",
  },
};
