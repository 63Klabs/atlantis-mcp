#!/usr/bin/env python3

# Chad Kluck
# 2026-01-08

# This script updates the AutoPublishCodeSha256 and VersionDescription fields
#  in a SAM template file with the current timestamp. This is useful for 
#  triggering new deployments of Lambda functions when the code changes.

# It overcomes a (bug?) in which a new alias cannot be replaced during deployment.

# The downside is that even if the Lambda code did not change (maybe only the 
#  template did) this forces a new Lambda deployment.

# BUT that may be desired and more than likely, 99% of your deployments are due
#  to Lambda function updates anyways.

# You can always choose to comment out execution of this script in your 
#  buildspec if you find it unnecessary, but keep it around if you ever 
#  experience CloudFormation deployment issues related to Lambda versions and 
#  aliases.

import re
import datetime
import sys

def update_timestamp(template_path):
    # Generate current timestamp in YYYYMMDDTHHMM format
    current_timestamp = datetime.datetime.now().strftime("%Y%m%dT%H%M")
    
    # Read the template file
    with open(template_path, 'r') as file:
        content = file.read()
    
    # Replace the AutoPublishCodeSha256 value with the new timestamp
    updated_content = re.sub(
        r'(AutoPublishCodeSha256:\s*)"[^"]*"',
        r'\1"' + current_timestamp + '"',
        content
    )
    
    # Update VersionDescription to append timestamp
    updated_content = re.sub(
        r'(VersionDescription:\s*)"([^"]*?)"',
        r'\1"\2 - ' + current_timestamp + '"',
        updated_content
    )

    # Write the updated content back to the file
    with open(template_path, 'w') as file:
        file.write(updated_content)
    
    print(f"Updated AutoPublishCodeSha256 to {current_timestamp}")
    print(f"Updated VersionDescription with timestamp {current_timestamp}")

if __name__ == "__main__":
    template_path = sys.argv[1] if len(sys.argv) > 1 else "template.yml"
    update_timestamp(template_path)