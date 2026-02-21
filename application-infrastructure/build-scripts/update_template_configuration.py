#!/usr/bin/env python3

# Chad Kluck
# 2026-01-08

# The template-configuration.json file includes parameter and tag values to 
#  use during application stack deployment. Many of the values are dynamically 
#  generated using environment variables.

# This is more flexible and maintainable than the traditional `sed` command 
#  as you only need to set an environment variable and use it within the file
#  without having to update a complex `sed` one-liner command.

# Placeholders in the file are in the format of $PLACE_HOLDER$ which are used 
#  to replace with the corresponding environment variable. For example, 
#  $STAGE_ID$ is replaced with the environment variable STAGE_ID.

# You can always add your own environment variables in buildspec to then use 
#  within the template-configuration.json file. You might do this instead of 
#  hard-coding in case you want to set values conditionally based upon other
#  factors.

# 1. Read in the template-configuration.json file and find all the placeholders.
# 2. Do a search/replace of the placeholders by using to corresponding 
#    environment variable. For example, if the environment variable STAGE_ID=dev 
#    is set, then the placeholder $STAGE_ID$ is replaced with the value dev.
# 3. Overwrite template-configuration.json with the modified file (this will
#    not affect any files in the repository).

# The template-configuration.json file is used by the 
#  `aws cloudformation package` command to provide the application stack 
#  parameters and tags.

import re
import os
import sys
def replace_placeholders(template_config_path):

    try:
        config_file = None

        if os.path.exists(template_config_path):
            config_file = template_config_path
        elif os.path.exists(f'../{template_config_path}'):
            config_file = f'../{template_config_path}'
        
        if config_file:
            with open(config_file, 'r') as f:
                config = f.read()

                # create a back-up copy
                with open(f'{config_file}.bak', 'w') as backup:
                    backup.write(config)

                # Find all the placeholders in the format of $PLACE_HOLDER$
                placeholders = re.findall(r'\$([A-Z_][A-Z0-9_]*)\$', config)
                print(f"Found {len(placeholders)} placeholders in {config_file}")
                # remove duplicates
                placeholders = list(set(placeholders))
                print(f"Unique placeholders {len(placeholders)}: {placeholders}")

                # For each placeholder, replace with the corresponding environment variable
                for placeholder in placeholders:
                    # check to see if environment variable is set
                    if placeholder not in os.environ:
                        print(f"Error: {placeholder} environment variable not set", file=sys.stderr)
                        exit()
                    config = config.replace(f'${placeholder}$', os.environ[placeholder])
            # Write the modified file
            with open(config_file, 'w') as f:
                f.write(config)
        else:
            print(f"Error: {template_config_path} not found", file=sys.stderr)
            exit()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        exit()

def exit():
    print(f"Exiting {sys.argv[0]}...")
    sys.exit(1)

def main():
    template_config_path = sys.argv[1] if len(sys.argv) > 1 else "template-configuration.json"
    replace_placeholders(template_config_path)
    print(f"Updated {template_config_path} by replacing placeholders with environment variable values")

if __name__ == "__main__":
    main()