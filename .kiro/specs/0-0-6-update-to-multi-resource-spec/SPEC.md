# Update to Multi-Resource steering document specs

Atlantis specs have been formalized for the organization and maintenance of multi function stacks.

This repository already adheres to many of the requirements outline in the steering document atlantis-multi-resource-src but not all.

We need to ensure this repository with it's multiple functions and static resources are up to date and adhere to these guidelines now and moving forward.

- Ensure Functions are specified in the template and organized in the src directory correctly
- Ensure layers are specified in the template and organized in the src directly correctly
- All resources are most likely already named, there should be no Lambda resource named `AppFunction`
- Ensure the buildspec and buildspec-postdeploy.yml use the updated install, build, test, audit command for functions, layers, and static

We need to ensure there are no breaking changes and need to double check our work.

Ask any clarifying questions in QUESTIONS.md and I will answer them there before we move on to the spec driven workflow.