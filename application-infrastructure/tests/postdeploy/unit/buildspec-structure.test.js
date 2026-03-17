// Unit tests for buildspec-postdeploy.yml structure
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 9.1, 9.4

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const BUILDSPEC_PATH = path.resolve(
  __dirname,
  '../../../buildspec-postdeploy.yml'
);

describe('buildspec-postdeploy.yml structure', () => {
  let buildspec;

  beforeAll(() => {
    const content = fs.readFileSync(BUILDSPEC_PATH, 'utf8');
    buildspec = yaml.load(content);
  });

  it('should be a valid YAML file with version 0.2', () => {
    expect(buildspec).toBeDefined();
    expect(buildspec.version).toBe(0.2);
  });

  it('should have install and build phases', () => {
    expect(buildspec.phases).toBeDefined();
    expect(buildspec.phases.install).toBeDefined();
    expect(buildspec.phases.build).toBeDefined();
  });

  describe('install phase', () => {
    it('should reference Redoc (loaded from CDN, not installed via npm)', () => {
      // Redoc is loaded from CDN at runtime in the generated HTML.
      // Verify the buildspec raw content contains a note about this.
      const rawContent = fs.readFileSync(BUILDSPEC_PATH, 'utf8');
      expect(rawContent).toContain('Redoc');
    });

    it('should install Pandoc via package manager', () => {
      const commands = buildspec.phases.install.commands;
      const hasPandocInstall = commands.some(
        (cmd) => typeof cmd === 'string' && cmd.includes('pandoc')
      );
      expect(hasPandocInstall).toBe(true);
    });
  });

  describe('build phase', () => {
    let buildCommands;

    beforeAll(() => {
      buildCommands = buildspec.phases.build.commands;
    });

    it('should define PUBLIC_DOC_DIRS with default value of tools', () => {
      const publicDocDirsCmd = buildCommands.find(
        (cmd) =>
          typeof cmd === 'string' &&
          cmd.includes('PUBLIC_DOC_DIRS') &&
          cmd.includes('tools')
      );
      expect(publicDocDirsCmd).toBeDefined();
    });

    it('should not include deployment, integration, or maintainer in PUBLIC_DOC_DIRS default', () => {
      const publicDocDirsCmd = buildCommands.find(
        (cmd) =>
          typeof cmd === 'string' &&
          cmd.includes('export PUBLIC_DOC_DIRS')
      );
      expect(publicDocDirsCmd).toBeDefined();
      // The default value portion is "${PUBLIC_DOC_DIRS:-tools}"
      // It should not contain deployment, integration, or maintainer as defaults
      const defaultMatch = publicDocDirsCmd.match(/:-([^}]+)}/);
      if (defaultMatch) {
        const defaultValue = defaultMatch[1];
        expect(defaultValue).not.toMatch(/deployment/);
        expect(defaultValue).not.toMatch(/integration/);
        expect(defaultValue).not.toMatch(/maintainer/);
      }
    });

    it('should execute scripts in correct order', () => {
      const scriptCommands = buildCommands.filter(
        (cmd) =>
          typeof cmd === 'string' &&
          cmd.includes('bash') &&
          cmd.includes('postdeploy-scripts/')
      );

      expect(scriptCommands.length).toBe(4);

      // Verify ordering
      expect(scriptCommands[0]).toContain('01-export-api-spec.sh');
      expect(scriptCommands[1]).toContain('02-generate-api-docs.sh');
      expect(scriptCommands[2]).toContain('03-generate-markdown-docs.sh');
      expect(scriptCommands[3]).toContain('04-consolidate-and-deploy.sh');
    });

    it('should invoke scripts with bash -e to halt on non-zero exit', () => {
      const scriptCommands = buildCommands.filter(
        (cmd) =>
          typeof cmd === 'string' &&
          cmd.includes('postdeploy-scripts/')
      );

      for (const cmd of scriptCommands) {
        expect(cmd).toMatch(/bash\s+-e\s+/);
      }
    });
  });
});
