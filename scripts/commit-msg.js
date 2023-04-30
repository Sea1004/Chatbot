import fs from 'node:fs'

import { LogHelper } from '@/helpers/log-helper'

/**
 * This script is executed after "git commit" or "git merge" (Git hook https://git-scm.com/docs/githooks#_commit_msg)
 * it ensures the authenticity of commit messages
 */
;(async () => {
  LogHelper.info('Checking commit message...')

  const commitEditMsgFile = '.git/COMMIT_EDITMSG'

  if (fs.existsSync(commitEditMsgFile)) {
    try {
      const commitMessage = await fs.promises.readFile(
        commitEditMsgFile,
        'utf8'
      )
      const regex =
        '(build|BREAKING|chore|ci|docs|feat|fix|perf|refactor|style|test)(\\((web app|scripts|docker|server|hotword|tcp server|bridge\\/(python|nodejs)|skill\\/([\\w-]+)))?\\)?: .{1,50}'

      if (commitMessage.match(regex) !== null) {
        LogHelper.success('Commit message validated')
      } else {
        LogHelper.error(`Commit message does not match the format: ${regex}`)
        process.exit(1)
      }
    } catch (e) {
      LogHelper.error(e.message)
      process.exit(1)
    }
  }
})()
