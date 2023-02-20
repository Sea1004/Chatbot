/**
 * TODO next:
 * 1. Fix brain.ts TS errors
 * 2. Refactor brain.ts; split "execute" into smaller functions:
 * logic type actions (executeLogicAction)
 * dialog type actions (executeDialogAction)
 * 3. Fix nlu.ts TS errors
 * 4. Refactor nlu.ts; split into smaller functions
 * 5. Restore multi client support on HTTP server / socket server
 * 6. Publish to "develop" (or just fix TS errors only and publish first, then refactor)
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'

import type { ShortLanguageCode } from '@/types'
import type { GlobalAnswersSchema } from '@/schemas/global-data-schemas'
import type {
  NLPAction,
  NLPDomain,
  NLPSkill,
  NLPUtterance,
  NEREntity,
  NLUResult,
  NLUSlots,
  NLUSlot,
  NERCustomEntity
} from '@/core/nlp/types'
import type { SkillConfigSchema } from '@/schemas/skill-schemas'
import { langs } from '@@/core/langs.json'
import { HAS_TTS, PYTHON_BRIDGE_BIN_PATH, TMP_PATH } from '@/constants'
import { SOCKET_SERVER, TTS } from '@/core'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { StringHelper } from '@/helpers/string-helper'
import Synchronizer from '@/core/synchronizer'

enum SkillOutputType {
  Intermediate = 'inter',
  End = 'end'
}
enum SkillActionType {
  Logic = 'logic',
  Dialog = 'dialog'
}

interface SkillCoreData {
  restart?: boolean
  isInActionLoop?: boolean
  showNextActionSuggestions?: boolean
  showSuggestions?: boolean
}

interface SkillResult {
  domain: NLPDomain
  skill: NLPSkill
  action: NLPAction
  lang: ShortLanguageCode
  utterance: NLPUtterance
  entities: NEREntity[]
  slots: NLUSlots
  output: {
    type: SkillOutputType
    codes: string[]
    speech: string
    core: SkillCoreData | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: Record<string, any>
  }
}

interface BrainProcessResult extends NLUResult {
  speeches: string[]
  executionTime: number
  utteranceId? : string
  lang?: ShortLanguageCode
  core?: SkillCoreData | undefined
  action?: SkillConfigSchema['actions'][string]
  nextAction?: SkillConfigSchema['actions'][string] | null | undefined
}

interface BrainExecutionOptions {
  mute?: boolean
}

// TODO: split class

export default class Brain {
  private static instance: Brain
  private _lang: ShortLanguageCode = 'en'
  private broca: GlobalAnswersSchema = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'core/data', this._lang, 'answers.json'),
      'utf8'
    )
  )
  private skillProcess: ChildProcessWithoutNullStreams | undefined = undefined

  constructor() {
    if (!Brain.instance) {
      LogHelper.title('Brain')
      LogHelper.success('New instance')

      Brain.instance = this
    }
  }

  get lang(): ShortLanguageCode {
    return this._lang
  }

  set lang(newLang: ShortLanguageCode) {
    this._lang = newLang
    // Update broca
    this.broca = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'core/data', this._lang, 'answers.json'),
        'utf8'
      )
    )

    if (HAS_TTS) {
      this.updateTTSLang(this._lang)
    }
  }

  private async updateTTSLang(newLang: ShortLanguageCode): Promise<void> {
    await TTS.init(newLang)

    LogHelper.title('Brain')
    LogHelper.info('Language has changed')
  }

  /**
   * Delete intent object file
   */
  static deleteIntentObjFile(intentObjectPath: string): void {
    try {
      if (fs.existsSync(intentObjectPath)) {
        fs.unlinkSync(intentObjectPath)
      }
    } catch (e) {
      LogHelper.error(`Failed to delete intent object file: ${e}`)
    }
  }

  /**
   * Make Leon talk
   */
  talk(rawSpeech: string, end = false): void {
    LogHelper.title('Leon')
    LogHelper.info('Talking...')

    if (rawSpeech !== '') {
      if (HAS_TTS) {
        // Stripe HTML to a whitespace. Whitespace to let the TTS respects punctuation
        const speech = rawSpeech.replace(/<(?:.|\n)*?>/gm, ' ')

        TTS.add(speech, end)
      }

      SOCKET_SERVER.socket.emit('answer', rawSpeech)
    }
  }

  /**
   * Pickup speech info we need to return
   */
  // TODO: handle return type
  wernicke(type: string, key?: string, obj?: Record<string, unknown>): string {
    let answerObject: Record<string, string> = {}
    let answer = ''

    // Choose a random answer or a specific one
    let property = this.broca.answers[type]
    if (property?.constructor === [].constructor) {
      property = property as string[]
      answer = property[Math.floor(Math.random() * property.length)] as string
    } else {
      answerObject = property as Record<string, string>
    }

    // Select a specific key
    if (key !== '' && typeof key !== 'undefined') {
      answer = answerObject[key] as string
    }

    // Parse sentence's value(s) and replace with the given object
    if (typeof obj !== 'undefined' && Object.keys(obj).length > 0) {
      answer = StringHelper.findAndMap(answer, obj)
    }

    return answer
  }

  /**
   * Execute Python skills
   * TODO: split into several methods
   */
  execute(obj: NLUResult, opts: BrainExecutionOptions): Promise<Partial<BrainProcessResult>> {
    const executionTimeStart = Date.now()
    opts = opts || {
      mute: false // Close Leon's mouth e.g. over HTTP
    }

    return new Promise(async (resolve, reject) => {
      const utteranceId = `${Date.now()}-${StringHelper.random(4)}`
      const intentObjectPath = path.join(TMP_PATH, `${utteranceId}.json`)
      const speeches: string[] = []

      // Ask to repeat if Leon is not sure about the request
      if (
        obj.classification.confidence <
        langs[LangHelper.getLongCode(this._lang)].min_confidence
      ) {
        if (!opts.mute) {
          const speech = `${this.wernicke('random_not_sure')}.`

          speeches.push(speech)
          this.talk(speech, true)
          SOCKET_SERVER.socket.emit('is-typing', false)
        }

        const executionTimeEnd = Date.now()
        const executionTime = executionTimeEnd - executionTimeStart

        resolve({
          speeches,
          executionTime
        })
      } else {
        const {
          configDataFilePath,
          classification: { action: actionName }
        } = obj
        const { actions }: { actions: SkillConfigSchema['actions'] } = JSON.parse(
          fs.readFileSync(configDataFilePath, 'utf8')
        )
        const action = actions[actionName] as SkillConfigSchema['actions'][string]
        const { type: actionType } = action
        const nextAction = action.next_action
          ? actions[action.next_action]
          : null

        if (actionType === SkillActionType.Logic) {
          /**
           * "Logic" action skill execution
           */

          // Ensure the process is empty (to be able to execute other processes outside of Brain)
          if (!this.skillProcess) {
            /**
             * Execute a skill in a standalone way (CLI):
             *
             * 1. Need to be at the root of the project
             * 2. Edit: server/src/intent-object.sample.json
             * 3. Run: npm run python-bridge
             */
            const slots: { [key: string]: NLUSlot['value'] | undefined } = {}
            if (obj.slots) {
              Object.keys(obj.slots)?.forEach((slotName) => {
                slots[slotName] = obj.slots[slotName]?.value
              })
            }
            const intentObj = {
              id: utteranceId,
              lang: this._lang,
              domain: obj.classification.domain,
              skill: obj.classification.skill,
              action: obj.classification.action,
              utterance: obj.utterance,
              current_entities: obj.currentEntities,
              entities: obj.entities,
              current_resolvers: obj.currentResolvers,
              resolvers: obj.resolvers,
              slots
            }

            try {
              fs.writeFileSync(intentObjectPath, JSON.stringify(intentObj))
              this.skillProcess = spawn(
                `${PYTHON_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
                { shell: true }
              )
            } catch (e) {
              LogHelper.error(`Failed to save intent object: ${e}`)
            }
          }

          const domainName = obj.classification.domain
          const skillName = obj.classification.skill
          const { name: domainFriendlyName } =
            SkillDomainHelper.getSkillDomainInfo(domainName)
          const { name: skillFriendlyName } = SkillDomainHelper.getSkillInfo(
            domainName,
            skillName
          )
          let skillOutput = ''

          // Read output
          this.skillProcess?.stdout.on('data', (data) => {
            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart

            try {
              const obj = JSON.parse(data.toString())

              if (typeof obj === 'object') {
                if (obj.output.type === SkillOutputType.Intermediate) {
                  LogHelper.title(`${skillFriendlyName} skill`)
                  LogHelper.info(data.toString())

                  const speech = obj.output.speech.toString()
                  if (!opts.mute) {
                    this.talk(speech)
                  }
                  speeches.push(speech)
                } else {
                  skillOutput += data
                }
              } else {
                reject({
                  type: 'warning',
                  obj: new Error(
                    `The "${skillFriendlyName}" skill from the "${domainFriendlyName}" domain is not well configured. Check the configuration file.`
                  ),
                  speeches,
                  executionTime
                })
              }
            } catch (e) {
              LogHelper.title('Brain')
              LogHelper.debug(`process.stdout: ${String(data)}`)

              reject({
                type: 'error',
                obj: new Error(
                  `The "${skillFriendlyName}" skill from the "${domainFriendlyName}" domain isn't returning JSON format.`
                ),
                speeches,
                executionTime
              })
            }
          })

          // Handle error
          this.skillProcess?.stderr.on('data', (data) => {
            const speech = `${this.wernicke('random_skill_errors', '', {
              '%skill_name%': skillFriendlyName,
              '%domain_name%': domainFriendlyName
            })}!`
            if (!opts.mute) {
              this.talk(speech)
              SOCKET_SERVER.socket.emit('is-typing', false)
            }
            speeches.push(speech)

            Brain.deleteIntentObjFile(intentObjectPath)

            LogHelper.title(`${skillFriendlyName} skill`)
            LogHelper.error(data.toString())

            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart
            reject({
              type: 'error',
              obj: new Error(data),
              speeches,
              executionTime
            })
          })

          // Catch the end of the skill execution
          this.skillProcess?.stdout.on('end', () => {
            LogHelper.title(`${skillFriendlyName} skill`)
            LogHelper.info(skillOutput)

            let skillResult: SkillResult | undefined = undefined

            // Check if there is an output (no skill error)
            if (skillOutput !== '') {
              skillResult = JSON.parse(skillOutput)

              if (skillResult?.output.speech) {
                skillResult.output.speech = skillResult.output.speech.toString()
                if (!opts.mute) {
                  this.talk(skillResult.output.speech, true)
                }
                speeches.push(skillResult.output.speech)

                // Synchronize the downloaded content if enabled
                if (
                  skillResult.output.type === SkillOutputType.End &&
                  skillResult.output.options['synchronization'] &&
                  skillResult.output.options['synchronization'].enabled &&
                  skillResult.output.options['synchronization'].enabled === true
                ) {
                  const sync = new Synchronizer(
                    this,
                    obj.classification,
                    skillResult.output.options['synchronization']
                  )

                  // When the synchronization is finished
                  sync.synchronize((speech: string) => {
                    if (!opts.mute) {
                      this.talk(speech)
                    }
                    speeches.push(speech)
                  })
                }
              }
            }

            Brain.deleteIntentObjFile(intentObjectPath)

            if (!opts.mute) {
              SOCKET_SERVER.socket.emit('is-typing', false)
            }

            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart

            // Send suggestions to the client
            if (
              nextAction?.suggestions &&
              skillResult?.output.core?.showNextActionSuggestions
            ) {
              SOCKET_SERVER.socket.emit('suggest', nextAction.suggestions)
            }
            if (action?.suggestions && skillResult?.output.core?.showSuggestions) {
              SOCKET_SERVER.socket.emit('suggest', action.suggestions)
            }

            resolve({
              utteranceId,
              lang: this._lang,
              ...obj,
              speeches,
              core: skillResult?.output.core,
              action,
              nextAction,
              executionTime // In ms, skill execution time only
            })
          })

          // Reset the child process
          this.skillProcess = undefined
        } else {
          /**
           * "Dialog" action skill execution
           */

          const configFilePath = path.join(
            process.cwd(),
            'skills',
            obj.classification.domain,
            obj.classification.skill,
            'config',
            `${this._lang}.json`
          )
          const { actions, entities } = await SkillDomainHelper.getSkillConfig(
            configFilePath,
            this._lang
          )
          const utteranceHasEntities = obj.entities.length > 0
          const { answers: rawAnswers } = obj
          let answers = rawAnswers
          let answer: string | undefined = ''

          if (!utteranceHasEntities) {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') === -1
            )
          } else {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') !== -1
            )
          }

          // When answers are simple without required entity
          if (answers.length === 0) {
            answer =
              rawAnswers[Math.floor(Math.random() * rawAnswers.length)]?.answer

            // In case the expected answer requires a known entity
            if (answer?.indexOf('{{') !== -1) {
              // TODO
              answers = actions[obj.classification.action]?.unknown_answers
              answer = answers[Math.floor(Math.random() * answers.length)]
            }
          } else {
            answer = answers[Math.floor(Math.random() * answers.length)]?.answer

            /**
             * In case the utterance contains entities, and the picked up answer too,
             * then map them (utterance <-> answer)
             */
            if (utteranceHasEntities && answer?.indexOf('{{') !== -1) {
              obj.currentEntities.forEach((entityObj) => {
                answer = StringHelper.findAndMap(answer as string, {
                  [`{{ ${entityObj.entity} }}`]: (entityObj as NERCustomEntity).resolution.value
                })

                // Find matches and map deeper data from the NLU file (global entities)
                const matches = answer.match(/{{.+?}}/g)

                matches?.forEach((match) => {
                  let newStr = match.substring(3)

                  newStr = newStr.substring(0, newStr.indexOf('}}') - 1)

                  const [entity, dataKey] = newStr.split('.')

                  if (entity && dataKey && entity === entityObj.entity) {
                    // e.g. entities.color.options.red.data.usage
                    const valuesArr =
                      entities[entity].options[entityObj.option].data[dataKey]

                    answer = StringHelper.findAndMap(answer as string, {
                      [match]:
                        valuesArr[Math.floor(Math.random() * valuesArr.length)]
                    })
                  }
                })
              })
            }
          }

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          if (!opts.mute) {
            this.talk(answer as string, true)
            SOCKET_SERVER.socket.emit('is-typing', false)
          }

          // Send suggestions to the client
          if (nextAction?.suggestions) {
            SOCKET_SERVER.socket.emit('suggest', nextAction.suggestions)
          }

          resolve({
            utteranceId,
            lang: this._lang,
            ...obj,
            speeches: [answer as string],
            core: {},
            action,
            nextAction,
            executionTime // In ms, skill execution time only
          })
        }
      }
    })
  }
}
