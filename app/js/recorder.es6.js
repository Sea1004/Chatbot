'use strict'

export default class Recorder {
  constructor (stream, el, info) {
    this.recorder = new MediaRecorder(stream, { audioBitsPerSecond: 16000 })
    this.el = el
    this.audioOn = new Audio('../sounds/on.mp3')
    this.audioOff = new Audio('../sounds/off.mp3')
    this.playSound = true
    this.info = info
  }

  start (playSound = true) {
    if (this.info.stt.enabled === false) {
      console.warn('Speech-to-text disabled')
    } else {
      this.playSound = playSound
      this.recorder.start(playSound)
    }
  }

  stop (playSound = true) {
    if (this.info.stt.enabled === false) {
      console.warn('Speech-to-text disabled')
    } else {
      this.playSound = playSound
      this.recorder.stop(playSound)
    }
  }

  onstart (cb) {
    this.recorder.onstart = (e) => {
      if (this.playSound === true) {
        this.audioOn.play()
      }
      this.el.classList.add('enabled')

      cb(e)
    }
  }

  onstop (cb) {
    this.recorder.onstop = (e) => {
      if (this.playSound === true) {
        this.audioOff.play()
      }
      this.el.classList.remove('enabled')

      cb(e)
    }
  }

  ondataavailable (cb) {
    this.recorder.ondataavailable = (e) => {
      cb(e)
    }
  }
}
