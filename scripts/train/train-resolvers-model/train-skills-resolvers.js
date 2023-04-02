import path from 'node:path'
import fs from 'node:fs'

import { composeFromPattern } from '@nlpjs/utils'

import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * Train skills resolvers
 */
export default (lang, nlp) =>
  new Promise(async (resolve) => {
    LogHelper.title('Skills resolvers training')

    const skillDomains = await SkillDomainHelper.getSkillDomains()

    skillDomains.forEach((currentDomain) => {
      const skillKeys = Object.keys(currentDomain.skills)

      skillKeys.forEach(async (skillName) => {
        const currentSkill = currentDomain.skills[skillName]
        const configFilePath = path.join(
          currentSkill.path,
          'config',
          `${lang}.json`
        )

        if (fs.existsSync(configFilePath)) {
          const { resolvers } = await SkillDomainHelper.getSkillConfig(
            configFilePath,
            lang
          )

          if (resolvers) {
            const resolversKeys = Object.keys(resolvers)

            resolversKeys.forEach((resolverName) => {
              const resolver = resolvers[resolverName]
              const intentKeys = Object.keys(resolver.intents)

              LogHelper.info(
                `[${lang}] Training ${skillName} "${resolverName}" resolver...`
              )

              intentKeys.forEach((intentName) => {
                const intent = `resolver.${currentSkill.name}.${resolverName}.${intentName}`
                const intentObj = resolver.intents[intentName]

                nlp.assignDomain(lang, intent, currentDomain.name)

                intentObj.utterance_samples.forEach((utteranceSample) => {
                  // Achieve Cartesian training
                  const utteranceAlternatives =
                    composeFromPattern(utteranceSample)

                  utteranceAlternatives.forEach((utteranceAlternative) => {
                    nlp.addDocument(lang, utteranceAlternative, intent)
                  })
                })
              })

              LogHelper.success(
                `[${lang}] ${skillName} "${resolverName}" resolver trained`
              )
            })
          }
        }
      })
    })

    resolve()
  })
