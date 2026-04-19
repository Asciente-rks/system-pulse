import * as yup from "yup";

export const createHealthSchema = yup.object({
  name: yup.string().required("Name is required").min(2),
  url: yup.string().required("URL is required").url("Must be a valid URL"),
  deploymentMode: yup
    .mixed<"auto" | "render" | "standard">()
    .oneOf(["auto", "render", "standard"]),
});

export const updateHealthSchema = yup.object({
  name: yup.string().min(2),
  url: yup.string().url("Must be a valid URL"),
});
