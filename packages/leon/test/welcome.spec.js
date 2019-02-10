'use strict'

describe('leon:welcome', async () => {
  test('welcomes', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Thank you')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('welcome')
  })
})
