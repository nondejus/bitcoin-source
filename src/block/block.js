import _ from 'lodash'
import $ from '../util/preconditions'
import BlockHeader from './blockheader'
import BN from '../crypto/bn'
import BufferReader from '../encoding/bufferreader'
import BufferWriter from '../encoding/bufferwriter'
import BufferUtil from '../util/buffer'
import Hash from '../crypto/hash'
import Transaction from '../transaction/transaction'

/**
 * Instantiate a Block from a Buffer, JSON object, or Object with
 * the properties of the Block
 *
 * @param {*} - A Buffer, JSON string, or Object
 * @returns {Block}
 * @constructor
 */

class Block {
  constructor(arg) {
    if (!(this instanceof Block)) {
      return new Block(arg)
    }
    _.extend(this, Block._from(arg))
    return this
  }

  /**
   * @param {*} - A Buffer, JSON string or Object
   * @returns {Object} - An object representing block data
   * @throws {TypeError} - If the argument was not recognized
   * @private
   */
  static _from(arg) {
    let info = {}
    if (BufferUtil.isBuffer(arg)) {
      info = Block._fromBufferReader(BufferReader(arg))
    } else if (_.isObject(arg)) {
      info = Block._fromObject(arg)
    } else {
      throw new TypeError('Unrecognized argument for Block')
    }
    return info
  }

  /**
   * @param {Object} - A plain JavaScript object
   * @returns {Object} - An object representing block data
   * @private
   */
  static _fromObject(data) {
    const transactions = []
    data.transactions.forEach(tx => {
      if (tx instanceof Transaction) {
        transactions.push(tx)
      } else {
        transactions.push(new Transaction().fromObject(tx))
      }
    })
    const info = {
      header: BlockHeader.fromObject(data.header),
      transactions
    }
    return info
  }

  /**
   * @param {Object} - A plain JavaScript object
   * @returns {Block} - An instance of block
   */
  static fromObject(obj) {
    const info = Block._fromObject(obj)
    return new Block(info)
  }

  /**
   * @param {BufferReader} - Block data
   * @returns {Object} - An object representing the block data
   * @private
   */
  static _fromBufferReader(br) {
    const info = {}
    $.checkState(!br.finished(), 'No block data received')
    info.header = BlockHeader.fromBufferReader(br)
    const transactions = br.readVarintNum()
    info.transactions = []
    for (let i = 0; i < transactions; i += 1) {
      info.transactions.push(new Transaction().fromBufferReader(br))
    }
    return info
  }

  /**
   * @param {BufferReader} - A buffer reader of the block
   * @returns {Block} - An instance of block
   */
  static fromBufferReader(br) {
    $.checkArgument(br, 'br is required')
    const info = Block._fromBufferReader(br)
    return new Block(info)
  }

  /**
   * @param {Buffer} - A buffer of the block
   * @returns {Block} - An instance of block
   */
  static fromBuffer(buf) {
    return Block.fromBufferReader(new BufferReader(buf))
  }

  /**
   * @param {string} - str - A hex encoded string of the block
   * @returns {Block} - A hex encoded string of the block
   */
  static fromString(str) {
    const buf = Buffer.from(str, 'hex')
    return Block.fromBuffer(buf)
  }

  /**
   * @param {Binary} - Raw block binary data or buffer
   * @returns {Block} - An instance of block
   */
  static fromRawBlock(data) {
    if (!BufferUtil.isBuffer(data)) {
      data = Buffer.from(data, 'binary')
    }
    const br = BufferReader(data)
    br.pos = Block.Values.START_OF_BLOCK
    const info = Block._fromBufferReader(br)
    return new Block(info)
  }

  /**
   * @returns {Object} - A plain object with the block properties
   */
  toJSON() {
    const transactions = []
    this.transactions.forEach(tx => {
      transactions.push(tx.toObject())
    })
    return {
      header: this.header.toObject(),
      transactions
    }
  }

  toObject() {
    return this.toJSON()
  }

  /**
   * @returns {Buffer} - A buffer of the block
   */
  toBuffer() {
    return this.toBufferWriter().concat()
  }

  /**
   * @returns {string} - A hex encoded string of the block
   */
  toString() {
    return this.toBuffer().toString('hex')
  }

  /**
   * @param {BufferWriter} - An existing instance of BufferWriter
   * @returns {BufferWriter} - An instance of BufferWriter representation of the Block
   */
  toBufferWriter(bw) {
    if (!bw) {
      bw = new BufferWriter()
    }
    bw.write(this.header.toBuffer())
    bw.writeVarintNum(this.transactions.length)
    for (let i = 0; i < this.transactions.length; i += 1) {
      this.transactions[i].toBufferWriter(bw)
    }
    return bw
  }

  /**
   * Will iterate through each transaction and return an array of hashes
   * @returns {Array} - An array with transaction hashes
   */
  getTransactionHashes() {
    const hashes = []
    if (this.transactions.length === 0) {
      return [Block.Values.NULL_HASH]
    }
    for (let t = 0; t < this.transactions.length; t += 1) {
      hashes.push(this.transactions[t]._getHash())
    }
    return hashes
  }

  /**
   * Will build a merkle tree of all the transactions, ultimately arriving at
   * a single point, the merkle root.
   * @link https://en.bitcoin.it/wiki/Protocol_specification#Merkle_Trees
   * @returns {Array} - An array with each level of the tree after the other.
   */
  getMerkleTree() {
    const tree = this.getTransactionHashes()

    let j = 0
    for (let size = this.transactions.length; size > 1; size = Math.floor((size + 1) / 2)) {
      for (let i = 0; i < size; i += 2) {
        const i2 = Math.min(i + 1, size - 1)
        const buf = Buffer.concat([tree[j + i], tree[j + i2]])
        tree.push(Hash.sha256sha256(buf))
      }
      j += size
    }

    return tree
  }

  /**
   * Calculates the merkleRoot from the transactions.
   * @returns {Buffer} - A buffer of the merkle root hash
   */
  getMerkleRoot() {
    const tree = this.getMerkleTree()
    return tree[tree.length - 1]
  }

  /**
   * Verifies that the transactions in the block match the header merkle root
   * @returns {Boolean} - If the merkle roots match
   */
  validMerkleRoot() {
    const h = new BN(this.header.merkleRoot.toString('hex'), 'hex')
    const c = new BN(this.getMerkleRoot().toString('hex'), 'hex')

    if (h.cmp(c) !== 0) {
      return false
    }

    return true
  }

  /**
   * @returns {Buffer} - The little endian hash buffer of the header
   */
  _getHash() {
    return this.header._getHash()
  }

  /**
   * @returns {string} - A string formatted for the console
   */
  inspect() {
    return `<Block ${this.id}>`
  }
}

// https://github.com/bitcoin/bitcoin/blob/b5fa132329f0377d787a4a21c1686609c2bfaece/src/primitives/block.h#L14
Block.MAX_BLOCK_SIZE = 1000000

const idProperty = {
  configurable: false,
  enumerable: true,
  /**
   * @returns {string} - The big endian hash buffer of the header
   */
  get() {
    if (!this._id) {
      this._id = this.header.id
    }
    return this._id
  },
  set: _.noop
}
Object.defineProperty(Block.prototype, 'id', idProperty)
Object.defineProperty(Block.prototype, 'hash', idProperty)

Block.Values = {
  START_OF_BLOCK: 8, // Start of block in raw block data
  NULL_HASH: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
}

// refactor progress

// get id() {
//   if (!this._id) {
//     this._id = this.header.id;
//   }
//   return this._id;
// }

// set id(header) {
//   this._id = _.noop();
// }

// get hash() {
//   if (!this._id) {
//     this._id = this.header.id;
//   }
//   return this._id;
// }

// set hash(header) {
//   this._id = _.noop();
// }

// Block = {
//   ...Block,
//   MAX_BLOCK_SIZE: 100000,
//   id: idProperty,
//   hash: idProperty,
//   Values: {
//     START_OF_BLOCK: 8, // Start of block in raw block data
//     NULL_HASH: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
//   },
// };

export default Block
