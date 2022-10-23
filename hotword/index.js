/**
 * This file allows to run a separate node to detect the wake word "Leon/Léon"
 * You can consider to run this file on a different hardware
 */

const axios = require('axios')
const record = require('node-record-lpcm16')
const { Detector, Models } = require('@bugsounet/snowboy')
const { io } = require('socket.io-client')

process.env.LEON_HOST = process.env.LEON_HOST || 'http://localhost'
process.env.LEON_PORT = process.env.LEON_PORT || 1337
const url = `${process.env.LEON_HOST}:${process.env.LEON_PORT}`
const socket = io(url)
const { argv } = process
const lang = argv[2] || 'en'

socket.on('connect', () => {
  socket.emit('init', 'hotword-node')
  console.log('Language:', lang)
  console.log('Connected to the server')
  console.log('Waiting for hotword...')
})
;(async () => {
  try {
    await axios.get(`${url}/api/v1/info`)

    const models = new Models()

    models.add({
      file: `${__dirname}/models/leon-${lang}.pmdl`,
      sensitivity: '0.5',
      hotwords: `leon-${lang}`
    })

    const detector = new Detector({
      resource: `${__dirname}/node_modules/@bugsounet/snowboy/resources/common.res`,
      models,
      audioGain: 2.0,
      applyFrontend: true
    })

    /*detector.on('silence', () => {
      })*/

    detector.on('sound', (/* buffer */) => {
      /**
       * <buffer> contains the last chunk of the audio that triggers the "sound" event.
       * It could be written to a wav stream
       */
    })

    detector.on('error', () => {
      console.error('error')
    })

    detector.on('hotword', (index, hotword, buffer) => {
      /**
       * <buffer> contains the last chunk of the audio that triggers the "hotword" event.
       * It could be written to a wav stream. You will have to use it
       * together with the <buffer> in the "sound" event if you want to get audio
       * data after the hotword
       */
      const obj = { hotword, buffer }

      console.log('Hotword detected', obj)
      socket.emit('hotword-detected', obj)
    })

    const mic = record.start({
      threshold: 0,
      verbose: false
    })

    mic.pipe(detector)
  } catch (e) {
    if (!e.response) {
      console.error(`Failed to reach the server: ${e}`)
    } else {
      console.error(e)
    }
  }
})()
