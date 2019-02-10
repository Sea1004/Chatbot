'use strict'

describe('leon:partnerassistant', async () => {
  test('does not know this personal assistant', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Tell me about the personal assistant Louistiti')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('unknown')
  })

  test('talks about the personal assistant Alexa', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Tell me about the personal assistant Alexa')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('success')
  })
})
