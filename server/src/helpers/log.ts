import fs from 'node:fs'
import path from 'node:path'

import { IS_TESTING_ENV } from '@/constants'
import { DATE } from '@/helpers/date'

class Log {
  static readonly ERRORS_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'logs',
    'errors.log'
  )

  private static instance: Log

  private constructor() {
    // Singleton
  }

  /**
   * TODO
   */
  public static getInstance() {
    if (Log.instance == null) {
      Log.instance = new Log()
    }

    return Log.instance
  }

  /**
   * TODO
   */
  public success(value: string) {
    console.log('\x1b[32m✅ %s\x1b[0m', value)
  }

  /**
   * TODO
   */
  public info(value: string) {
    console.info('\x1b[36mℹ️  %s\x1b[0m', value)
  }

  /**
   * TODO
   */
  public warning(value: string) {
    console.warn('\x1b[33m⚠️  %s\x1b[0m', value)
  }

  /**
   * TODO
   */
  public debug(value: string) {
    console.info('\u001b[35m🐞 [DEBUG] %s\x1b[0m', value)
  }

  /**
   * TODO
   */
  public error(value: string) {
    const data = `${DATE.getDateTime()} - ${value}`

    if (!IS_TESTING_ENV) {
      if (fs.existsSync(Log.ERRORS_PATH)) {
        fs.appendFileSync(Log.ERRORS_PATH, `\n${data}`)
      } else {
        fs.writeFileSync(Log.ERRORS_PATH, data, { flag: 'wx' })
      }
    }

    console.error('\x1b[31m🚨 %s\x1b[0m', value)
  }

  /**
   * TODO
   */
  public title(value: string) {
    console.log('\n\n\x1b[7m.: %s :.\x1b[0m', value.toUpperCase())
  }

  /**
   * TODO
   */
  public default(value: string) {
    console.log(value)
  }
}

export const LOG = Log.getInstance()
