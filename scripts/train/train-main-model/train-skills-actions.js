import path from 'node:path'
import fs from 'node:fs'

import { composeFromPattern } from '@nlpjs/utils'

import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * Train skills actions
 */
export default (lang, nlp) =>
  new Promise(async (resolve) => {
    LogHelper.title('Skills actions training')

    const supportedActionTypes = ['dialog', 'logic']
    const skillDomains = await SkillDomainHelper.getSkillDomains()

    for (const [domainName, currentDomain] of skillDomains) {
      const skillKeys = Object.keys(currentDomain.skills)

      LogHelper.info(`[${lang}] Training "${domainName}" domain model...`)

      for (let j = 0; j < skillKeys.length; j += 1) {
        const { name: skillName } = currentDomain.skills[skillKeys[j]]
        const currentSkill = currentDomain.skills[skillKeys[j]]

        LogHelper.info(`[${lang}] Using "${skillKeys[j]}" skill config data`)

        const configFilePath = path.join(
          currentSkill.path,
          'config',
          `${lang}.json`
        )

        if (fs.existsSync(configFilePath)) {
          const { actions, variables } = await SkillDomainHelper.getSkillConfig(
            configFilePath,
            lang
          )
          const actionsKeys = Object.keys(actions)

          for (let k = 0; k < actionsKeys.length; k += 1) {
            const actionName = actionsKeys[k]
            const actionObj = actions[actionName]
            const intent = `${skillName}.${actionName}`
            const {
              utterance_samples: utteranceSamples,
              answers,
              slots
            } = actionObj

            if (
              !actionObj.type ||
              !supportedActionTypes.includes(actionObj.type)
            ) {
              LogHelper.error(
                `This action type isn't supported: ${actionObj.type}`
              )
              process.exit(1)
            }

            nlp.assignDomain(lang, intent, currentDomain.name)

            if (slots) {
              for (let l = 0; l < slots.length; l += 1) {
                const slotObj = slots[l]

                /**
                 * TODO: handle entity within questions such as "Where does {{ hero }} live?"
                 * https://github.com/axa-group/nlp.js/issues/328
                 * https://github.com/axa-group/nlp.js/issues/291
                 * https://github.com/axa-group/nlp.js/issues/307
                 */
                if (slotObj.item.type === 'entity') {
                  nlp.slotManager.addSlot(
                    intent,
                    `${slotObj.name}#${slotObj.item.name}`,
                    true,
                    { [lang]: slotObj.questions }
                  )
                }
                /* nlp.slotManager
              .addSlot(intent, 'boolean', true, { [lang]: 'How many players?' }) */
              }
            }

            for (let l = 0; l < utteranceSamples?.length; l += 1) {
              const utterance = utteranceSamples[l]
              // Achieve Cartesian training
              const utteranceAlternatives = composeFromPattern(utterance)

              utteranceAlternatives.forEach((utteranceAlternative) => {
                nlp.addDocument(lang, utteranceAlternative, intent)
              })
            }

            // Train NLG if the action has a dialog type
            if (actionObj.type === 'dialog') {
              const variablesObj = {}

              // Dynamic variables binding if any variable is declared
              if (variables) {
                const variableKeys = Object.keys(variables)

                for (let l = 0; l < variableKeys.length; l += 1) {
                  const key = variableKeys[l]

                  variablesObj[`%${key}%`] = variables[variableKeys[l]]
                }
              }

              for (let l = 0; l < answers?.length; l += 1) {
                const variableKeys = Object.keys(variablesObj)
                if (variableKeys.length > 0) {
                  answers[l] = StringHelper.findAndMap(answers[l], variablesObj)
                }

                nlp.addAnswer(lang, `${skillName}.${actionName}`, answers[l])
              }
            }
          }
        }
      }

      LogHelper.success(`[${lang}] "${domainName}" domain trained`)
    }

    resolve()
  })
