---
inclusion: fileMatch
fileMatchPattern: 'application-infrastructure/**'
---

# Multi-Resource Source Directory Organization

This document governs the top-level organization of `application-infrastructure/src/` when a project contains (or is about to contain) more than one deployable resource — multiple Lambda functions, Lambda Layers with dependencies, or static sites.

**Out of scope:** Internal architecture of individual functions (MVC layout, framework choices, etc.) is governed by other steering documents such as `atlantis-webapi-node-cache-data.md`.

## Detecting Single-Src vs Multi-Src

**Single-src (legacy/starter layout):** `application-infrastructure/src/` contains a `package.json` or `requirements.txt` at its root alongside application code files (e.g., `index.js`, `controllers/`, `models/`).

**Multi-src (target layout):** `application-infrastructure/src/` contains only subdirectories — `lambda/`, `static/` — with no application code at the root level.

## Migration Trigger

When adding a second Lambda function, a Lambda Layer with its own dependencies, or a static site to a project that currently uses single-src layout:

1. **Migrate first.** Convert to multi-src structure before adding the new resource.
2. **Rename `AppFunction`.** The generic logical ID must be replaced with a descriptive PascalCase name that reflects the function's purpose.

Do not add a second resource alongside a flat `src/` layout. Always restructure first.

## Target Directory Structure

```
application-infrastructure/src/
├── lambda/
│   ├── <function-name>/          # lowercase-kebab, one per Lambda function
│   │   ├── .nvmrc                # Node.js version for this function
│   │   ├── package.json          # Node: function dependencies
│   │   └── ...                   # function internals (not governed here)
│   ├── <function-name-2>/
│   │   ├── .nvmrc
│   │   ├── package.json
│   │   └── ...
│   └── layers/
│       └── <layer-name>/         # lowercase-kebab, one per Layer
│           ├── package.json      # or requirements.txt
│           └── ...
└── static/                       # static site (if applicable)
    │   ├── package.json          # or equivalent build tool config
    └── ...
```

"Static" may be web site files, packaged scripts exported to S3, or artifacts meant to be sent to an external source. If there are multiple static resources (two web sites, or a web site and package repository), they should each get their own directory within `static/`.

### Naming Conventions

- **Function directories:** lowercase-kebab derived from the CloudFormation Resource suffix. Example: a function named `GetPerson` in CloudFormation lives at `src/lambda/get-person/`.
- **Layer directories:** lowercase-kebab describing the layer purpose (e.g., `common-utils`, `data-access`).
- **Static site:** `src/static/` for a single site. Use `src/static/<site-name>/` if multiple static sites exist.

### Isolation Rules

- Each function directory is **fully self-contained**: own `.nvmrc`, own `package.json` (or `requirements.txt` / `requirements-test.txt` / `requirements-dev.txt` for Python), own `node_modules`.
- **No shared source directories.** If code is used by multiple functions, it must be a Lambda Layer or a published npm/pip package.
- The `src/` root and `src/lambda/` root must never contain application code directly.

## Migration Procedure (Single-Src to Multi-Src)

Follow these steps in order when converting:

1. **Choose a descriptive kebab name** for the existing function (e.g., if `AppFunction` serves a web API, use `web-api` or `api-handler`).

2. **Create the target directory:**
   ```
   mkdir -p application-infrastructure/src/lambda/<function-name>
   ```

3. **Move all source files** from `src/` into `src/lambda/<function-name>/`:
   - `.nvmrc`, `package.json`, `package-lock.json`
   - `index.js` (or entry point), `jest.config.js`
   - All code directories: `config/`, `controllers/`, `models/`, `routes/`, `services/`, `utils/`, `views/`, `tests/`

4. **Rename the CloudFormation logical ID** from `AppFunction` to a descriptive PascalCase name (e.g., `ApiHandler`, `WebService`).

5. **Update `CodeUri`** in `template.yml` from `src/` to `src/lambda/<function-name>/`.

6. **Update all template references** to the old logical ID:
   - Log group name and `LogGroupName` property
   - Alarms (`Dimensions`, `AlarmActions`)
   - Lambda permissions (`FunctionName` references)
   - Outputs

7. **Update `buildspec.yml`** to use the multi-src loop pattern (see below). (Static sites may be deployed in a post-deploy stage using a similar `buildspec-postdeploy.yml` if present.)

8. **Add the new resource** in its own directory.

**CloudFormation rename warning:** Changing a logical ID causes CloudFormation to delete and recreate the resource. If the function already has a `FunctionName` property set (e.g., `!Sub '${Prefix}-${ProjectId}-${StageId}-AppFunction'`), the actual AWS function name is preserved — only the logical ID changes. If `FunctionName` was not explicitly set, add it before renaming the logical ID to prevent function deletion.

## Reference Buildspec Pattern (Multi-Src)

Replace the single-function `pre_build` commands with a loop over function directories:

```yaml
  pre_build:
    commands:


      # Application Environment: Build and test each Lambda function independently.
      # src/lambda/ holds one directory per function (multi-src layout). Each function
      # is fully self-contained with its own package.json, .nvmrc, and node_modules.
      # The loop picks up new functions automatically - no buildspec changes needed
      # when a function is added. The layers/ subdirectory is handled separately below.
      - echo "--- Building Lambda Functions ---"
      - |
        for func_dir in application-infrastructure/src/lambda/*/; do
          # Skip the layers directory (built separately)
          if [ "$(basename "$func_dir")" = "layers" ]; then
            continue
          fi

          echo "Processing function: $func_dir"
          cd "$CODEBUILD_SRC_DIR/$func_dir"

          # Install dev so we can run tests, but we will remove dev dependencies later
          npm install --include=dev
          # Run Test under test environment
          NODE_ENV=test npm test
          npm test

          # Clean up test artifacts and reinstall only production dependencies to reduce Lambda package size
          rm -rf __tests__ tests coverage node_modules
          npm ci --omit=dev

          # FAIL the build if npm audit has vulnerabilities it can't fix
          # Perform a fix to move us forward, then check to make sure there were no unresolved high fixes
          # We are making an intentional choice here:
          #     Make breaking changes in hopes to bring vulnerabilities to 0
          #      vs deploying packages with vulnerabilities
          npm audit fix --force --omit=dev
          npm audit --audit-level=high

          cd "$CODEBUILD_SRC_DIR"
        done

      # Build Lambda Layers (production dependencies only) if any exist
      - echo "--- Building Lambda Layers ---"
      - |
        if [ -d "application-infrastructure/src/lambda/layers" ]; then
          for layer_dir in application-infrastructure/src/lambda/layers/*/; do
            if [ -d "$layer_dir" ]; then
              echo "Processing layer: $layer_dir"
              cd "$CODEBUILD_SRC_DIR/$layer_dir"

              # Install dev so we can run tests, but we will remove dev dependencies later
              npm install --include=dev
              # Run Test under test environment
              NODE_ENV=test npm test
              npm test

              # Clean up test artifacts and reinstall only production dependencies to reduce Lambda package size
              rm -rf __tests__ tests coverage node_modules
              npm ci --omit=dev

              # FAIL the build if npm audit has vulnerabilities it can't fix
              # Perform a fix to move us forward, then check to make sure there were no unresolved high fixes
              # We are making an intentional choice here:
              #     Make breaking changes in hopes to bring vulnerabilities to 0
              #      vs deploying packages with vulnerabilities
              npm audit fix --force --omit=dev
              npm audit --audit-level=high

              cd "$CODEBUILD_SRC_DIR"

            fi
          done
        fi

      # Continue with existing build-scripts (SSM, etc.)
      - cd "$CODEBUILD_SRC_DIR/application-infrastructure"
      - python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}CacheData_SecureDataKey --generate 256
```

**Key points:**
- Use `$CODEBUILD_SRC_DIR` for absolute paths — avoids issues with nested `cd` commands.
- Skip the `layers/` subdirectory when iterating over function directories.
- Each function and layer is tested and audited independently.
- The `build` phase remains unchanged — `aws cloudformation package` resolves each function's `CodeUri`.

### Python Functions in the Loop

For Python Lambda functions, replace the npm commands:

```yaml
      - |
        for func_dir in application-infrastructure/src/lambda/*/; do
          if [ "$(basename "$func_dir")" = "layers" ]; then
            continue
          fi

          cd "$CODEBUILD_SRC_DIR/$func_dir"

          # Detect language by presence of requirements.txt vs package.json
          if [ -f "requirements.txt" ]; then
            pip install -r requirements.txt -t ./package
            if [ -f "requirements-test.txt" ]; then
              pip install -r requirements-test.txt
            fi
            pytest
            rm -rf __pycache__ .pytest_cache
          elif [ -f "package.json" ]; then
            npm install --include=dev
            npm test
            rm -rf tests __tests__ coverage node_modules
            npm ci --omit=dev
            npm audit fix --force --omit=dev
            npm audit --audit-level=high
          fi

          cd "$CODEBUILD_SRC_DIR"
        done
```

Perform a similar update for any Python Lambda layers.

## CloudFormation Template Adjustments

When a project moves to multi-function:

| Concern | Single-Src | Multi-Src |
|---------|-----------|-----------|
| Logical ID | `AppFunction` | Descriptive PascalCase (e.g., `ApiHandler`, `EventProcessor`) |
| CodeUri | `src/` | `src/lambda/<function-name>/` |
| FunctionName | `${Prefix}-${ProjectId}-${StageId}-AppFunction` | `${Prefix}-${ProjectId}-${StageId}-<ResourceName>` |
| Log Group | `/aws/lambda/...-AppFunction` | `/aws/lambda/...-<ResourceName>` |
| Layers | `ContentUri` not applicable | `ContentUri: src/lambda/layers/<layer-name>/` for `AWS::Serverless::LayerVersion` |
| ExecutionRole | `LambdaExecutionRole` | `<ResourceName>LambdaExecutionRole` |
| ApiGateway Permission to Invoke | `ConfigLambdaPermission`, `ConfigLambdaPermissionLive` | `Config<ResourceName>LambdaPermission`, `Config<ResourceName>LambdaPermissionLive` |

Each function requires its own:
- `AWS::Serverless::Function` resource
- `AWS::Logs::LogGroup`
- `AWS::Lambda::Permission` (if API Gateway-triggered)
- `AWS::CloudWatch::Alarm` (in production)
- `AWS::Lambda::Permission` (one for `PROD` (Live) and one for `DEV`/`TEST`)
- `AWS::IAM::Role` Lambda execution role scoped to the function needs (functions should not share execution roles but instead use managed policies for any common permissions)
- Corresponding IAM policy statements scoped to that function's resources

## Maintenance Rules

Once multi-src is established:

- **Adding a function:** Create `src/lambda/<function-name>/` with its own `package.json`, `.nvmrc`, and entry point. Add corresponding CloudFormation resources. The buildspec loop picks it up automatically.
- **Adding a layer:** Create `src/lambda/layers/<layer-name>/` with its own dependency file. Define `AWS::Serverless::LayerVersion` in the template.
- **Adding a static site:** Create `src/static/` with its own `package.json` and build config. Follow same buildspec pattern for install, build, test, and audit.
- **Removing a function:** Delete the directory, remove all corresponding CloudFormation resources, and verify the buildspec has no function-specific logic to clean up.
- **Never** place application code at `src/` root or `src/lambda/` root.
- **Never** create shared source directories (e.g., `src/shared/`, `src/common/`). Use a Layer or package.
- **Never** share `node_modules` or `.nvmrc` between functions.
