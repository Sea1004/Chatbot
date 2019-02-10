'use strict'

const string = { }

/**
 * Parse, map (with object) and replace value(s) in a string
 */
string.pnr = (s, obj) => s.replace(new RegExp(Object.keys(obj).join('|'), 'gi'), matched => obj[matched])

/**
 * Uppercase for the first letter
 */
string.ucfirst = s => s.charAt(0).toUpperCase() + s.substr(1)

/**
 * Random string
 */
string.random = n => Math.random().toString(36).slice(-n)

/**
 * Remove accents
 */
string.removeAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export default string
