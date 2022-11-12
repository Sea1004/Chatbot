import fs from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { BuiltinMicrosoft } from '@nlpjs/builtin-microsoft'
import { LangAll } from '@nlpjs/lang-all'
import axios from 'axios'
import kill from 'tree-kill'

import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import { HAS_LOGGER, IS_TESTING_ENV, TCP_SERVER_BIN_PATH } from '@/constants'
import Ner from '@/core/ner'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { TCP_CLIENT } from '@/core/tcp-client'
import Conversation from '@/core/conversation'

const defaultNluResultObj = {
  utterance: null,
  currentEntities: [],
  entities: [],
  currentResolvers: [],
  resolvers: [],
  slots: null,
  configDataFilePath: null,
  answers: [], // For dialog action type
  classification: {
    domain: null,
    skill: null,
    action: null,
    confidence: 0
  }
}

class Nlu {
  constructor(brain) {
    this.brain = brain
    this.globalResolversNlp = {}
    this.skillsResolversNlp = {}
    this.mainNlp = {}
    this.ner = {}
    this.conv = new Conversation('conv0')
    this.nluResultObj = defaultNluResultObj // TODO

    LogHelper.title('NLU')
    LogHelper.success('New instance')
  }

  /**
   * Load the global resolvers NLP model from the latest training
   */
  loadGlobalResolversModel(nlpModel) {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(nlpModel)) {
        LogHelper.title('NLU')
        reject({
          type: 'warning',
          obj: new Error(
            'The global resolvers NLP model does not exist, please run: npm run train'
          )
        })
      } else {
        LogHelper.title('NLU')

        try {
          const container = await containerBootstrap()

          container.use(Nlp)
          container.use(LangAll)

          this.globalResolversNlp = container.get('nlp')
          const nluManager = container.get('nlu-manager')
          nluManager.settings.spellCheck = true

          await this.globalResolversNlp.load(nlpModel)
          LogHelper.success('Global resolvers NLP model loaded')

          resolve()
        } catch (err) {
          this.brain.talk(
            `${this.brain.wernicke('random_errors')}! ${this.brain.wernicke(
              'errors',
              'nlu',
              { '%error%': err.message }
            )}.`
          )
          this.brain.socket.emit('is-typing', false)

          reject({ type: 'error', obj: err })
        }
      }
    })
  }

  /**
   * Load the skills resolvers NLP model from the latest training
   */
  loadSkillsResolversModel(nlpModel) {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(nlpModel)) {
        LogHelper.title('NLU')
        reject({
          type: 'warning',
          obj: new Error(
            'The skills resolvers NLP model does not exist, please run: npm run train'
          )
        })
      } else {
        try {
          const container = await containerBootstrap()

          container.use(Nlp)
          container.use(LangAll)

          this.skillsResolversNlp = container.get('nlp')
          const nluManager = container.get('nlu-manager')
          nluManager.settings.spellCheck = true

          await this.skillsResolversNlp.load(nlpModel)
          LogHelper.success('Skills resolvers NLP model loaded')

          resolve()
        } catch (err) {
          this.brain.talk(
            `${this.brain.wernicke('random_errors')}! ${this.brain.wernicke(
              'errors',
              'nlu',
              { '%error%': err.message }
            )}.`
          )
          this.brain.socket.emit('is-typing', false)

          reject({ type: 'error', obj: err })
        }
      }
    })
  }

  /**
   * Load the main NLP model from the latest training
   */
  loadMainModel(nlpModel) {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(nlpModel)) {
        LogHelper.title('NLU')
        reject({
          type: 'warning',
          obj: new Error(
            'The main NLP model does not exist, please run: npm run train'
          )
        })
      } else {
        try {
          const container = await containerBootstrap()

          container.register(
            'extract-builtin-??',
            new BuiltinMicrosoft({
              builtins: Ner.getMicrosoftBuiltinEntities()
            }),
            true
          )
          container.use(Nlp)
          container.use(LangAll)

          this.mainNlp = container.get('nlp')
          const nluManager = container.get('nlu-manager')
          nluManager.settings.spellCheck = true

          await this.mainNlp.load(nlpModel)
          LogHelper.success('Main NLP model loaded')

          this.ner = new Ner(this.mainNlp.ner)

          resolve()
        } catch (err) {
          this.brain.talk(
            `${this.brain.wernicke('random_errors')}! ${this.brain.wernicke(
              'errors',
              'nlu',
              { '%error%': err.message }
            )}.`
          )
          this.brain.socket.emit('is-typing', false)

          reject({ type: 'error', obj: err })
        }
      }
    })
  }

  /**
   * Check if NLP models exists
   */
  hasNlpModels() {
    return (
      Object.keys(this.globalResolversNlp).length > 0 &&
      Object.keys(this.skillsResolversNlp).length > 0 &&
      Object.keys(this.mainNlp).length > 0
    )
  }

  /**
   * Set new language; recreate a new TCP server with new language; and reprocess understanding
   */
  switchLanguage(utterance, locale, opts) {
    const connectedHandler = async () => {
      await this.process(utterance, opts)
    }

    this.brain.lang = locale
    this.brain.talk(`${this.brain.wernicke('random_language_switch')}.`, true)

    // Recreate a new TCP server process and reconnect the TCP client
    kill(global.tcpServerProcess.pid, () => {
      global.tcpServerProcess = spawn(`${TCP_SERVER_BIN_PATH} ${locale}`, {
        shell: true
      })

      TCP_CLIENT.connect()
      TCP_CLIENT.ee.removeListener('connected', connectedHandler)
      TCP_CLIENT.ee.on('connected', connectedHandler)
    })

    return {}
  }

  /**
   * Collaborative logger request
   */
  sendLog(utterance) {
    /* istanbul ignore next */
    if (HAS_LOGGER && !IS_TESTING_ENV) {
      axios.request({
        method: 'POST',
        url: 'https://logger.getleon.ai/v1/expressions',
        headers: { 'X-Origin': 'leon-core' },
        data: {
          version,
          utterance,
          lang: this.brain.lang,
          classification: this.nluResultObj.classification
        }
      })
    }
  }

  /**
   * Merge spaCy entities with the current NER instance
   */
  async mergeSpacyEntities(utterance) {
    const spacyEntities = await Ner.getSpacyEntities(utterance)
    if (spacyEntities.length > 0) {
      spacyEntities.forEach(({ entity, resolution }) => {
        const spacyEntity = {
          [entity]: {
            options: {
              [resolution.value]: [StringHelper.ucFirst(resolution.value)]
            }
          }
        }

        this.mainNlp.addEntities(spacyEntity, this.brain.lang)
      })
    }
  }

  /**
   * Handle in action loop logic before NLU processing
   */
  async handleActionLoop(utterance, opts) {
    const { domain, intent } = this.conv.activeContext
    const [skillName, actionName] = intent.split('.')
    const configDataFilePath = join(
      process.cwd(),
      'skills',
      domain,
      skillName,
      `config/${this.brain.lang}.json`
    )
    this.nluResultObj = {
      ...defaultNluResultObj, // Reset entities, slots, etc.
      slots: this.conv.activeContext.slots,
      utterance,
      configDataFilePath,
      classification: {
        domain,
        skill: skillName,
        action: actionName,
        confidence: 1
      }
    }
    this.nluResultObj.entities = await this.ner.extractEntities(
      this.brain.lang,
      configDataFilePath,
      this.nluResultObj
    )

    const { actions, resolvers } = JSON.parse(
      fs.readFileSync(configDataFilePath, 'utf8')
    )
    const action = actions[this.nluResultObj.classification.action]
    const { name: expectedItemName, type: expectedItemType } =
      action.loop.expected_item
    let hasMatchingEntity = false
    let hasMatchingResolver = false

    if (expectedItemType === 'entity') {
      hasMatchingEntity =
        this.nluResultObj.entities.filter(
          ({ entity }) => expectedItemName === entity
        ).length > 0
    } else if (expectedItemType.indexOf('resolver') !== -1) {
      const nlpObjs = {
        global_resolver: this.globalResolversNlp,
        skill_resolver: this.skillsResolversNlp
      }
      const result = await nlpObjs[expectedItemType].process(utterance)
      const { intent } = result

      const resolveResolvers = (resolver, intent) => {
        const resolversPath = join(
          process.cwd(),
          'core/data',
          this.brain.lang,
          'global-resolvers'
        )
        // Load the skill resolver or the global resolver
        const resolvedIntents = !intent.includes('resolver.global')
          ? resolvers[resolver]
          : JSON.parse(fs.readFileSync(join(resolversPath, `${resolver}.json`)))

        // E.g. resolver.global.denial -> denial
        intent = intent.substring(intent.lastIndexOf('.') + 1)

        return [
          {
            name: expectedItemName,
            value: resolvedIntents.intents[intent].value
          }
        ]
      }

      // Resolve resolver if global resolver or skill resolver has been found
      if (
        intent &&
        (intent.includes('resolver.global') ||
          intent.includes(`resolver.${skillName}`))
      ) {
        LogHelper.title('NLU')
        LogHelper.success('Resolvers resolved:')
        this.nluResultObj.resolvers = resolveResolvers(expectedItemName, intent)
        this.nluResultObj.resolvers.forEach((resolver) =>
          LogHelper.success(`${intent}: ${JSON.stringify(resolver)}`)
        )
        hasMatchingResolver = this.nluResultObj.resolvers.length > 0
      }
    }

    // Ensure expected items are in the utterance, otherwise clean context and reprocess
    if (!hasMatchingEntity && !hasMatchingResolver) {
      this.brain.talk(`${this.brain.wernicke('random_context_out_of_topic')}.`)
      this.conv.cleanActiveContext()
      await this.process(utterance, opts)
      return null
    }

    try {
      const processedData = await this.brain.execute(this.nluResultObj, {
        mute: opts.mute
      })
      // Reprocess with the original utterance that triggered the context at first
      if (processedData.core?.restart === true) {
        const { originalUtterance } = this.conv.activeContext

        this.conv.cleanActiveContext()
        await this.process(originalUtterance, opts)
        return null
      }

      /**
       * In case there is no next action to prepare anymore
       * and there is an explicit stop of the loop from the skill
       */
      if (
        !processedData.action.next_action &&
        processedData.core?.isInActionLoop === false
      ) {
        this.conv.cleanActiveContext()
        return null
      }

      // Break the action loop and prepare for the next action if necessary
      if (processedData.core?.isInActionLoop === false) {
        this.conv.activeContext.isInActionLoop = !!processedData.action.loop
        this.conv.activeContext.actionName = processedData.action.next_action
        this.conv.activeContext.intent = `${processedData.classification.skill}.${processedData.action.next_action}`
      }

      return processedData
    } catch (e) /* istanbul ignore next */ {
      return null
    }
  }

  /**
   * Handle slot filling
   */
  async handleSlotFilling(utterance, opts) {
    const processedData = await this.slotFill(utterance, opts)

    /**
     * In case the slot filling has been interrupted. e.g. context change, etc.
     * Then reprocess with the new utterance
     */
    if (!processedData) {
      await this.process(utterance, opts)
      return null
    }

    if (processedData && Object.keys(processedData).length > 0) {
      // Set new context with the next action if there is one
      if (processedData.action.next_action) {
        this.conv.activeContext = {
          lang: this.brain.lang,
          slots: processedData.slots,
          isInActionLoop: !!processedData.nextAction.loop,
          originalUtterance: processedData.utterance,
          configDataFilePath: processedData.configDataFilePath,
          actionName: processedData.action.next_action,
          domain: processedData.classification.domain,
          intent: `${processedData.classification.skill}.${processedData.action.next_action}`,
          entities: []
        }
      }
    }

    return processedData
  }

  /**
   * Classify the utterance,
   * pick-up the right classification
   * and extract entities
   */
  process(utterance, opts) {
    const processingTimeStart = Date.now()

    return new Promise(async (resolve, reject) => {
      LogHelper.title('NLU')
      LogHelper.info('Processing...')

      opts = opts || {
        mute: false // Close Leon mouth e.g. over HTTP
      }

      if (!this.hasNlpModels()) {
        if (!opts.mute) {
          this.brain.talk(`${this.brain.wernicke('random_errors')}!`)
          this.brain.socket.emit('is-typing', false)
        }

        const msg =
          'The NLP model is missing, please rebuild the project or if you are in dev run: npm run train'
        LogHelper.error(msg)
        return reject(msg)
      }

      // Add spaCy entities
      await this.mergeSpacyEntities(utterance)

      // Pre NLU processing according to the active context if there is one
      if (this.conv.hasActiveContext()) {
        // When the active context is in an action loop, then directly trigger the action
        if (this.conv.activeContext.isInActionLoop) {
          return resolve(await this.handleActionLoop(utterance, opts))
        }

        // When the active context has slots filled
        if (Object.keys(this.conv.activeContext.slots).length > 0) {
          try {
            return resolve(await this.handleSlotFilling(utterance, opts))
          } catch (e) {
            return reject({})
          }
        }
      }

      const result = await this.mainNlp.process(utterance)
      const { locale, answers, classifications } = result
      let { score, intent, domain } = result

      /**
       * If a context is active, then use the appropriate classification based on score probability.
       * E.g. 1. Create my shopping list; 2. Actually delete it.
       * If there are several "delete it" across skills, Leon needs to make use of
       * the current context ({domain}.{skill}) to define the most accurate classification
       */
      if (this.conv.hasActiveContext()) {
        classifications.forEach(({ intent: newIntent, score: newScore }) => {
          if (newScore > 0.6) {
            const [skillName] = newIntent.split('.')
            const newDomain = this.mainNlp.getIntentDomain(locale, newIntent)
            const contextName = `${newDomain}.${skillName}`
            if (this.conv.activeContext.name === contextName) {
              score = newScore
              intent = newIntent
              domain = newDomain
            }
          }
        })
      }

      const [skillName, actionName] = intent.split('.')
      this.nluResultObj = {
        ...defaultNluResultObj, // Reset entities, slots, etc.
        utterance,
        answers, // For dialog action type
        classification: {
          domain,
          skill: skillName,
          action: actionName,
          confidence: score
        }
      }

      const isSupportedLanguage = LangHelper.getShortCodes().includes(locale)
      if (!isSupportedLanguage) {
        this.brain.talk(
          `${this.brain.wernicke('random_language_not_supported')}.`,
          true
        )
        this.brain.socket.emit('is-typing', false)
        return resolve({})
      }

      // Trigger language switching
      if (this.brain.lang !== locale) {
        return resolve(this.switchLanguage(utterance, locale, opts))
      }

      // this.sendLog()

      if (intent === 'None') {
        const fallback = this.fallback(
          langs[LangHelper.getLongCode(locale)].fallbacks
        )

        if (fallback === false) {
          if (!opts.mute) {
            this.brain.talk(
              `${this.brain.wernicke('random_unknown_intents')}.`,
              true
            )
            this.brain.socket.emit('is-typing', false)
          }

          LogHelper.title('NLU')
          const msg = 'Intent not found'
          LogHelper.warning(msg)

          const processingTimeEnd = Date.now()
          const processingTime = processingTimeEnd - processingTimeStart

          return resolve({
            processingTime,
            message: msg
          })
        }

        this.nluResultObj = fallback
      }

      LogHelper.title('NLU')
      LogHelper.success(
        `Intent found: ${this.nluResultObj.classification.skill}.${this.nluResultObj.classification.action} (domain: ${this.nluResultObj.classification.domain})`
      )

      const configDataFilePath = join(
        process.cwd(),
        'skills',
        this.nluResultObj.classification.domain,
        this.nluResultObj.classification.skill,
        `config/${this.brain.lang}.json`
      )
      this.nluResultObj.configDataFilePath = configDataFilePath

      try {
        this.nluResultObj.entities = await this.ner.extractEntities(
          this.brain.lang,
          configDataFilePath,
          this.nluResultObj
        )
      } catch (e) /* istanbul ignore next */ {
        if (LogHelper[e.type]) {
          LogHelper[e.type](e.obj.message)
        }

        if (!opts.mute) {
          this.brain.talk(`${this.brain.wernicke(e.code, '', e.data)}!`)
        }
      }

      const shouldSlotLoop = await this.routeSlotFilling(intent)
      if (shouldSlotLoop) {
        return resolve({})
      }

      // In case all slots have been filled in the first utterance
      if (
        this.conv.hasActiveContext() &&
        Object.keys(this.conv.activeContext.slots).length > 0
      ) {
        try {
          return resolve(await this.handleSlotFilling(utterance, opts))
        } catch (e) {
          return reject({})
        }
      }

      const newContextName = `${this.nluResultObj.classification.domain}.${skillName}`
      if (this.conv.activeContext.name !== newContextName) {
        this.conv.cleanActiveContext()
      }
      this.conv.activeContext = {
        lang: this.brain.lang,
        slots: {},
        isInActionLoop: false,
        originalUtterance: this.nluResultObj.utterance,
        configDataFilePath: this.nluResultObj.configDataFilePath,
        actionName: this.nluResultObj.classification.action,
        domain: this.nluResultObj.classification.domain,
        intent,
        entities: this.nluResultObj.entities
      }
      // Pass current utterance entities to the NLU result object
      this.nluResultObj.currentEntities =
        this.conv.activeContext.currentEntities
      // Pass context entities to the NLU result object
      this.nluResultObj.entities = this.conv.activeContext.entities

      try {
        const processedData = await this.brain.execute(this.nluResultObj, {
          mute: opts.mute
        })

        // Prepare next action if there is one queuing
        if (processedData.nextAction) {
          this.conv.cleanActiveContext()
          this.conv.activeContext = {
            lang: this.brain.lang,
            slots: {},
            isInActionLoop: !!processedData.nextAction.loop,
            originalUtterance: processedData.utterance,
            configDataFilePath: processedData.configDataFilePath,
            actionName: processedData.action.next_action,
            domain: processedData.classification.domain,
            intent: `${processedData.classification.skill}.${processedData.action.next_action}`,
            entities: []
          }
        }

        const processingTimeEnd = Date.now()
        const processingTime = processingTimeEnd - processingTimeStart

        return resolve({
          processingTime, // In ms, total time
          ...processedData,
          nluProcessingTime: processingTime - processedData?.executionTime // In ms, NLU processing time only
        })
      } catch (e) /* istanbul ignore next */ {
        LogHelper[e.type](e.obj.message)

        if (!opts.mute) {
          this.brain.socket.emit('is-typing', false)
        }

        return reject(e.obj)
      }
    })
  }

  /**
   * Build NLU data result object based on slots
   * and ask for more entities if necessary
   */
  async slotFill(utterance, opts) {
    if (!this.conv.activeContext.nextAction) {
      return null
    }

    const { domain, intent } = this.conv.activeContext
    const [skillName, actionName] = intent.split('.')
    const configDataFilePath = join(
      process.cwd(),
      'skills',
      domain,
      skillName,
      `config/${this.brain.lang}.json`
    )

    this.nluResultObj = {
      ...defaultNluResultObj, // Reset entities, slots, etc.
      utterance,
      classification: {
        domain,
        skill: skillName,
        action: actionName
      }
    }
    const entities = await this.ner.extractEntities(
      this.brain.lang,
      configDataFilePath,
      this.nluResultObj
    )

    // Continue to loop for questions if a slot has been filled correctly
    let notFilledSlot = this.conv.getNotFilledSlot()
    if (notFilledSlot && entities.length > 0) {
      const hasMatch = entities.some(
        ({ entity }) => entity === notFilledSlot.expectedEntity
      )

      if (hasMatch) {
        this.conv.setSlots(this.brain.lang, entities)

        notFilledSlot = this.conv.getNotFilledSlot()
        if (notFilledSlot) {
          this.brain.talk(notFilledSlot.pickedQuestion)
          this.brain.socket.emit('is-typing', false)

          return {}
        }
      }
    }

    if (!this.conv.areSlotsAllFilled()) {
      this.brain.talk(`${this.brain.wernicke('random_context_out_of_topic')}.`)
    } else {
      this.nluResultObj = {
        ...defaultNluResultObj, // Reset entities, slots, etc.
        // Assign slots only if there is a next action
        slots: this.conv.activeContext.nextAction
          ? this.conv.activeContext.slots
          : {},
        utterance: this.conv.activeContext.originalUtterance,
        configDataFilePath,
        classification: {
          domain,
          skill: skillName,
          action: this.conv.activeContext.nextAction,
          confidence: 1
        }
      }

      this.conv.cleanActiveContext()

      return this.brain.execute(this.nluResultObj, { mute: opts.mute })
    }

    this.conv.cleanActiveContext()
    return null
  }

  /**
   * Decide what to do with slot filling.
   * 1. Activate context
   * 2. If the context is expecting slots, then loop over questions to slot fill
   * 3. Or go to the brain executor if all slots have been filled in one shot
   */
  async routeSlotFilling(intent) {
    const slots = await this.mainNlp.slotManager.getMandatorySlots(intent)
    const hasMandatorySlots = Object.keys(slots)?.length > 0

    if (hasMandatorySlots) {
      this.conv.activeContext = {
        lang: this.brain.lang,
        slots,
        isInActionLoop: false,
        originalUtterance: this.nluResultObj.utterance,
        configDataFilePath: this.nluResultObj.configDataFilePath,
        actionName: this.nluResultObj.classification.action,
        domain: this.nluResultObj.classification.domain,
        intent,
        entities: this.nluResultObj.entities
      }

      const notFilledSlot = this.conv.getNotFilledSlot()
      // Loop for questions if a slot hasn't been filled
      if (notFilledSlot) {
        const { actions } = JSON.parse(
          fs.readFileSync(this.nluResultObj.configDataFilePath, 'utf8')
        )
        const [currentSlot] = actions[
          this.nluResultObj.classification.action
        ].slots.filter(({ name }) => name === notFilledSlot.name)

        this.brain.socket.emit('suggest', currentSlot.suggestions)
        this.brain.talk(notFilledSlot.pickedQuestion)
        this.brain.socket.emit('is-typing', false)

        return true
      }
    }

    return false
  }

  /**
   * Pickup and compare the right fallback
   * according to the wished skill action
   */
  fallback(fallbacks) {
    const words = this.nluResultObj.utterance.toLowerCase().split(' ')

    if (fallbacks.length > 0) {
      LogHelper.info('Looking for fallbacks...')
      const tmpWords = []

      for (let i = 0; i < fallbacks.length; i += 1) {
        for (let j = 0; j < fallbacks[i].words.length; j += 1) {
          if (words.includes(fallbacks[i].words[j]) === true) {
            tmpWords.push(fallbacks[i].words[j])
          }
        }

        if (JSON.stringify(tmpWords) === JSON.stringify(fallbacks[i].words)) {
          this.nluResultObj.entities = []
          this.nluResultObj.classification.domain = fallbacks[i].domain
          this.nluResultObj.classification.skill = fallbacks[i].skill
          this.nluResultObj.classification.action = fallbacks[i].action
          this.nluResultObj.classification.confidence = 1

          LogHelper.success('Fallback found')
          return this.nluResultObj
        }
      }
    }

    return false
  }
}

export default Nlu
