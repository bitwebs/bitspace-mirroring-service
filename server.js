const { NanoresourcePromise: Nanoresource } = require('nanoresource-promise/emitter')
const Client = require('./client')
const BitspaceClient = require('bitspace/client')
const Bittree = require('@web4/bittree')
const bitdrive = require('@web4/bitdrive')

const RPC = require('./rpc')
const getNetworkOptions = require('./rpc/socket.js')

const DB_NAMESPACE = 'bitspace-mirroring-service'
const DB_VERSION = 'v1'
const CHAINS_SUB = 'chains'
const TYPES_SUB = 'types'

module.exports = class MirroringService extends Nanoresource {
  constructor (opts = {}) {
    super()
    this.server = RPC.createServer(opts.server, this._onConnection.bind(this))
    this.mirroring = new Set()
    this.downloads = new Map()
    this.bsClient = null
    this.db = null

    this._chainstore = null
    this._socketOpts = getNetworkOptions(opts)
  }

  // Nanoresource Methods

  async _open () {
    let running = false
    try {
      const client = new Client({ ...this._socketOpts, noRetry: true })
      await client.ready()
      running = true
    } catch (_) {}
    if (running) throw new Error('A mirroring server is already running on that host/port.')

    this.bsClient = new BitspaceClient()
    await this.bsClient.ready()
    this._chainstore = this.bsClient.chainstore(DB_NAMESPACE)

    const rootDb = new Bittree(this._chainstore.default(), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    }).sub(DB_VERSION)
    await rootDb.ready()
    this.chainsDb = rootDb.sub(CHAINS_SUB)
    this.typesDb = rootDb.sub(TYPES_SUB)

    await this.server.listen(this._socketOpts)
    return this._restartMirroring()
  }

  async _close () {
    await this.server.close()
    for (const { chain, request } of  this.downloads.values()) {
      chain.undownload(request)
    }
    this.downloads.clear()
    this.mirroring.clear()
    await this.bsClient.close()
  }

  // Mirroring Methods

  async _getDriveChains (key, replicate) {
    const drive = bitdrive(this._chainstore, key)
    drive.on('error', noop)
    await drive.promises.ready()
    if (replicate) await this.bsClient.replicate(drive.metadata)
    return new Promise((resolve, reject) => {
      drive.getContent((err, content) => {
        if (err) return reject(err)
        return resolve({ content, metadata: drive.metadata })
      })
    })
  }

  async _restartMirroring () {
    for await (const { key } of this.chainsDb.createReadStream()) {
      await this._mirrorChain(key)
    }
  }

  async _mirrorChain (key, chain, noReplicate) {
    chain = chain || this._chainstore.get(key)
    await chain.ready()
    if (!noReplicate) await this.bsClient.replicate(chain)
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    this.downloads.set(keyString, {
      chain,
      request: chain.download()
    })
    // TODO: What metadata should we store?
    await this.chainsDb.put(keyString, {})
    this.mirroring.add(keyString)
  }

  // TODO: Make mount-aware
  async _mirrorDrive (key) {
    const { content, metadata } = await this._getDriveChains(key, true)
    return Promise.all([
      this._mirrorChain(metadata.key, metadata, true),
      this._mirrorChain(content.key, content, true)
    ])
  }

  async _unmirrorChain (key, noUnreplicate) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    if (!this.downloads.has(keyString)) return
    const { chain, request } = this.downloads.get(keyString)
    if (!noUnreplicate) await this.bsClient.network.configure(chain.discoveryKey, {
      announce: false
    })
    chain.undownload(request)
    this.downloads.delete(keyString)
    this.mirroring.delete(keyString)
    return this.chainsDb.del(keyString)
  }

  // TODO: Make mount-aware
  async _unmirrorDrive (key) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    if (!this.downloads.has(keyString)) return
    const { metadata, content } = await this._getDriveChains(key)
    await this.bsClient.network.configure(metadata.discoveryKey, {
      announce: false
    })
    return Promise.all([
      this._unmirrorChain(metadata.key),
      this._unmirrorChain(content.key)
    ])
  }

  async _mirror ({ key, type }) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    if (!type || type === 'unichain') await this._mirrorChain(key)
    else if (type === 'bitdrive') await this._mirrorDrive(key)
    await this.typesDb.put(key.toString('hex'), type)
    return this._status({ key, type })
  }

  async _unmirror ({ key, type }) {
    if (typeof key === 'string') key = Buffer.from(key, 'hex')
    if (!type || type === 'unichain') await this._unmirrorChain(key)
    else if (type === 'bitdrive') await this._unmirrorDrive(key)
    await this.typesDb.del(key.toString('hex'))
    return this._status({ key, type })
  }

  // Info Methods

  _status ({ key, type }) {
    const keyString = (typeof key === 'string') ? key : key.toString('hex')
    return {
      key,
      type,
      mirroring: this.mirroring.has(keyString)
    }
  }

  async _list () {
    const mirroring = []
    for await (const { key, value: type } of this.typesDb.createReadStream()) {
      mirroring.push({
        type,
        key: Buffer.from(key, 'hex'),
        mirroring: true
      })
    }
    return {
      mirroring
    }
  }

  // Connection Handling

  _onConnection (client) {
    this.emit('client-open', client)
    client.on('close', () => {
      this.emit('client-close', client)
    })
    client.mirror.onRequest({
      mirror: this._mirror.bind(this),
      unmirror: this._unmirror.bind(this),
      status: this._status.bind(this),
      list: this._list.bind(this),
      stop: this._close.bind(this),
    })
  }
}

function noop () {}
