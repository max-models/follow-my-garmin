import { defineConfig } from "astro/config";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER;

export default defineConfig({
  output: "static",
  site: isGithubActions && repositoryOwner ? `https://${repositoryOwner}.github.io` : undefined,
  base: isGithubActions && repoName ? `/${repoName}` : undefined,
});
