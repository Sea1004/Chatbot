'use strict'

describe('leon:whoami', async () => {
  test('introduces himself', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Who are you?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('introduction')
  })
})
