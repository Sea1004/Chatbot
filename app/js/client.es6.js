'use strict'

import Chatbot from './chatbot.es6'

export default class Client {
  constructor (client, host, port, input, res) {
    this.client = client
    this.host = host
    this.port = port
    this._input = input
    this.socket = io.connect(`http://${this.host}:${this.port}`)
    this.history = localStorage.getItem('history')
    this.parsedHistory = []
    this.info = res
    this.chatbot = new Chatbot()
  }

  set input (newInput) {
    if (typeof newInput !== 'undefined') {
      this._input.value = newInput
    }
  }

  init (config) {
    this.chatbot.init()

    this.socket.on('connect', () => {
      this.socket.emit('init', this.client)
    })

    this.socket.on('answer', (data) => {
      this.chatbot.receivedFrom('leon', data)
    })

    this.socket.on('is-typing', (data) => {
      this.chatbot.isTyping('leon', data)
    })

    this.socket.on('recognized', (data, cb) => {
      this._input.value = data
      this.send('query')

      cb('string-received')
    })

    this.socket.on('audio-forwarded', (data, cb) => {
      const ctx = new AudioContext()
      const source = ctx.createBufferSource()

      ctx.decodeAudioData(data, (buffer) => {
        source.buffer = buffer

        source.connect(ctx.destination)
        source.start(0)
      })

      cb('audio-received')
    })

    this.socket.on('download', (data) => {
      window.location = `http://${config.server_host}:${config.server_port}/v1/downloads?package=${data.package}&module=${data.module}`
    })

    if (this.history !== null) {
      this.parsedHistory = JSON.parse(this.history)
    }
  }

  send (keyword) {
    if (this._input.value !== '') {
      this.socket.emit(keyword, { client: this.client, value: this._input.value.trim() })
      this.chatbot.sendTo('leon', this._input.value)

      this.save()

      return true
    }

    return false
  }

  save () {
    let val = this._input.value

    if (localStorage.getItem('history') === null) {
      localStorage.setItem('history', JSON.stringify([]))
      this.parsedHistory = JSON.parse(localStorage.getItem('history'))
    } else if (this.parsedHistory.length >= 32) {
      this.parsedHistory.shift()
    }

    if (val[0] === ' ') {
      val = val.substr(1, val.length - 1)
    }

    if (this.parsedHistory[this.parsedHistory.length - 1] !== val) {
      this.parsedHistory.push(val)
      localStorage.setItem('history', JSON.stringify(this.parsedHistory))
    }

    this._input.value = ''
  }
}
