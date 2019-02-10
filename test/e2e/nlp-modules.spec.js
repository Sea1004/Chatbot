'use strict'

import fs from 'fs'
import path from 'path'
import execa from 'execa'

import Nlu from '@/core/nlu'
import Brain from '@/core/brain'

/**
 * This test will test the Leon's NLP (Natural Language Processing):
 * 1. Browse every expression for each module
 * 2. Check if it matches its respective module
 * 3. Execute the module at least once
 *
 * Do not forget to train your expressions after this test (already included in e2e npm script)
 */

jest.setTimeout(60000) // Specify jest.setTimeout here as this test does not have config file

describe('NLU modules', () => {
  const { langs } = JSON.parse(fs.readFileSync(path.join(global.paths.root, 'core', 'langs.json'), 'utf8'))
  const langKeys = Object.keys(langs)
  const packages = fs.readdirSync(global.paths.packages)
    .filter(entity =>
      fs.statSync(path.join(global.paths.packages, entity)).isDirectory())

  for (let i = 0; i < langKeys.length; i += 1) {
    // eslint-disable-next-line no-loop-func
    describe(`${langKeys[i]} language`, () => {
      const lang = langs[langKeys[i]]
      const nlu = new Nlu()
      const brain = new Brain({ emit: jest.fn() }, lang.short)
      let expressions = { }

      nlu.brain = { wernicke: jest.fn(), talk: jest.fn(), socket: { emit: jest.fn() } }
      brain.talk = jest.fn()

      beforeAll(async () => {
        // Generate new classifier for the tested language
        await execa.shell(`npm run train expressions:${lang.short}`)
        // Load the new classifier
        await nlu.loadModel(global.paths.classifier)
      })

      process.env.LEON_LANG = langKeys[i]

      for (let j = 0; j < packages.length; j += 1) {
        // eslint-disable-next-line no-loop-func
        describe(`${packages[j]} package`, () => {
          const expressionsFile = `${global.paths.packages}/${packages[j]}/data/expressions/${lang.short}.json`
          expressions = JSON.parse(fs.readFileSync(expressionsFile, 'utf8'))

          const modules = Object.keys(expressions)
          for (let k = 0; k < modules.length; k += 1) {
            // eslint-disable-next-line no-loop-func
            describe(`${modules[k]} module`, () => {
              const exprs = expressions[modules[k]]
              let isModuleExecutedOnce = false

              for (let l = 0; l < exprs.length; l += 1) {
                // eslint-disable-next-line no-loop-func
                test(`"${exprs[l]}" queries this module`, async () => {
                  // Need to redefine the NLU brain execution to update the mocking
                  nlu.brain.execute = jest.fn()

                  nlu.process(exprs[l])
                  const [obj] = nlu.brain.execute.mock.calls

                  // Execute/test each module one time (otherwise this test would be slow)
                  if (isModuleExecutedOnce === false) {
                    try {
                      await brain.execute(obj[0]) // eslint-disable-line no-await-in-loop
                      expect(brain.talk).toHaveBeenCalled()
                    } catch (e) {
                      // expect() just to break the test if the module execution fails
                      expect(brain.talk).toBe(false)
                    }

                    isModuleExecutedOnce = true
                  }

                  expect(obj[0].classification.package).toBe(packages[j])
                  expect(obj[0].classification.module).toBe(modules[k])
                })
              }
            })
          }
        })
      }
    })
  }
})
