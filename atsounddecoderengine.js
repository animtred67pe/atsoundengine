/*
 * Anim Tred Sound Decoder Engine
 *
 * v1.1.3 (13-10-2024)
 *
 * (c) 2024 ATFSMedia Productions
 */

var ATSoundDecoderEngine = (function() {
	const ArrayBufferStream = function(arrayBuffer, start = 0, end = arrayBuffer.byteLength) {
		this.arrayBuffer = arrayBuffer;
		this.dataView = new DataView(this.arrayBuffer);
		this.littleEndian = false;
		this.start = start;
		this.end = end;
		this._position = start;
	}
	Object.defineProperties(ArrayBufferStream.prototype, {
		position: {
			get: function() {
				return this._position - this.start;
			},
			set: function(value) {
				this._position = (value + this.start);
			}
		}
	});
	ArrayBufferStream.prototype.extract = function(length) {
		var abs = new ArrayBufferStream(this.arrayBuffer, this._position, this._position + length);
		abs.littleEndian = this.littleEndian;
		return abs;
	}
	ArrayBufferStream.prototype.readString = function(length) {
		var str = '';
		for (var i = 0; i < length; i++) {
			str += String.fromCharCode(this.dataView.getUint8(this._position++));
		}
		return str;
	}
	ArrayBufferStream.prototype.readUnsignedByte = function() {
		return this.dataView.getUint8(this._position++);
	}
	ArrayBufferStream.prototype.readUnsignedShort = function() {
		var val = this.dataView.getUint16(this._position, this.littleEndian);
		this._position += 2;
		return val;
	}
	ArrayBufferStream.prototype.readUnsignedInt = function() {
		var val = this.dataView.getUint32(this._position, this.littleEndian);
		this._position += 4;
		return val;
	}
	ArrayBufferStream.prototype.readByte = function() {
		return this.dataView.getInt8(this._position++);
	}
	ArrayBufferStream.prototype.readShort = function() {
		var val = this.dataView.getInt16(this._position, this.littleEndian);
		this._position += 2;
		return val;
	}
	ArrayBufferStream.prototype.readInt = function() {
		var val = this.dataView.getInt32(this._position, this.littleEndian);
		this._position += 4;
		return val;
	}
	ArrayBufferStream.prototype.readFloat = function() {
		var val = this.dataView.getFloat32(this._position, this.littleEndian);
		this._position += 4;
		return val;
	}
	ArrayBufferStream.prototype.readDouble = function() {
		var val = this.dataView.getFloat64(this._position, this.littleEndian);
		this._position += 8;
		return val;
	}
	ArrayBufferStream.prototype.readBytes = function(length) {
		var bytes = new Uint8Array(length);
		for (var i = 0; i < length; i++) {
			bytes[i] = this.dataView.getUint8(this._position++);
		}
		return bytes.buffer;
	}
	ArrayBufferStream.prototype.getLength = function() {
		return this.end - this.start;
	}
	ArrayBufferStream.prototype.getBytesAvailable = function() {
		return this.end - this._position;
	}
	const WAVStreamDecoder = function(data) {
		this.stream = data;
		this.startOffset = 0;
		this.endOffset = 0;
		this.sampleCount = 0;
		this.rate = 48000;
		this.channels = 1;
		this.sampleLength = 0;
		this.isLoad = false;

		this.execudeSample = null;

		this.type = 'WAVE';

		// channels
		this.channelLeft = null;
		this.channelRight = null;

		this.bitsPerSample = 0;
		this.sampleIndex = 0;

		// adpcm
		this.adpcmBlockSize = 0;
	}
	WAVStreamDecoder.STEP_TABLE = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
	WAVStreamDecoder.INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
	WAVStreamDecoder.deltaDecoder = function(index, code) {
		const step = WAVStreamDecoder.STEP_TABLE[index];
		let delta = 0;
		if (code & 4) delta += step;
		if (code & 2) delta += step >> 1;
		if (code & 1) delta += step >> 2;
		delta += step >> 3;
		return (code & 8) ? -delta : delta;
	}
	WAVStreamDecoder.prototype.start = function() {
		var stream = this.stream;
		stream.littleEndian = true;
		stream.position = 0;
		this.readHeader();
		var formatChunk = this.extractChunk('fmt ', stream);
		if (formatChunk.getLength() < 16) {
			throw new Error('WAVFile: format chunk is too small');
		}
		this.encoding = formatChunk.readUnsignedShort();
		this.channels = formatChunk.readUnsignedShort();
		this.rate = formatChunk.readUnsignedInt();
		this.bytesPerSecond = formatChunk.readUnsignedInt();
		this.blockAlignment = formatChunk.readUnsignedShort();
		this.bitsPerSample = formatChunk.readUnsignedShort();
		if (formatChunk.getLength() >= 18 && this.encoding == 0xFFFE) {
			var extensionSize = formatChunk.readUnsignedShort();
			if (extensionSize == 22) {
				this.validBitsPerSample = formatChunk.readUnsignedShort();
				this.channelMask = formatChunk.readUnsignedInt();
				this.encoding = formatChunk.readUnsignedShort();
			}
		}
		this.compressedData = this.extractChunk('data', stream);
		var sampleDataSize = this.compressedData.getLength();
		if (this.encoding == 1) {
			this.type = 'UNCOMPRESSED ' + this.bitsPerSample + 'BIT';
			switch (this.bitsPerSample) {
				case 8:
					this.sampleLength = sampleDataSize;
					this.execudeSample = this.getSample8Uncompressed;
					break;
				case 16:
					this.sampleLength = sampleDataSize / 2;
					this.execudeSample = this.getSample16Uncompressed;
					break;
				case 24:
					this.sampleLength = sampleDataSize / 3;
					this.execudeSample = this.getSample24Uncompressed;
					break;
				case 32:
					this.sampleLength = sampleDataSize / 4;
					this.execudeSample = this.getSample32Uncompressed;
					break;
				case 64:
					this.sampleLength = sampleDataSize / 8;
					this.execudeSample = this.getSample64Uncompressed;
					break;
				default:
					console.log(this.bitsPerSample);
			}
		} else if (this.encoding == 3) {
			this.sampleLength = Math.floor(sampleDataSize / (this.bitsPerSample >>> 3));
			this.type = 'UNCOMPRESSED FLOAD ' + this.bitsPerSample + 'BIT';
			switch (this.bitsPerSample) {
				case 32:
					this.execudeSample = this.getSample32UncompressedFloat;
					break;
				case 64:
					this.execudeSample = this.getSample64UncompressedFloat;
					break;
			}
		} else if (this.encoding == 17) {
			if (formatChunk.getLength() < 20) {
				throw new Error('WAVFile: adpcm format chunk is too small');
			}
			formatChunk.position += 2;
			var samplesPerBlock = formatChunk.readShort();
			this.adpcmBlockSize = (((samplesPerBlock - 1) / 2) + 4);
			var factChunk = this.extractChunk('fact', stream);
			if ((factChunk != null) && (factChunk.getLength() == 4)) {
				this.sampleLength = factChunk.readInt() * this.channels;
			} else {
				const available = this.compressedData.getBytesAvailable();
				const blocks = (available / this.adpcmBlockSize) | 0;
				const fullBlocks = blocks * (2 * (this.adpcmBlockSize - 4)) + 1;
				const subBlock = Math.max((available % this.adpcmBlockSize) - 4, 0) * 2;
				const incompleteBlock = Math.min(available % this.adpcmBlockSize, 1);
				const channelSubBit = this.channels - 1;
				this.sampleLength = ((fullBlocks + subBlock + incompleteBlock) >> channelSubBit) << channelSubBit;
			}
			this.type = 'IMA ADPCM ' + this.bitsPerSample + 'BIT';
			this.execudeSample = this.getSampleADPCM;
		} else if (this.encoding == 85) {
			var factChunk = this.extractChunk('fact', stream);
			if ((factChunk != null) && (factChunk.getLength() == 4)) {
				this.sampleLength = factChunk.readInt();
			}
			this.type = 'WAVE 85 ' + this.bitsPerSample + 'BIT';
			this.execudeSample = function() {};
		} else {
			throw new Error("WAVFile: unknown encoding " + this.encoding);
		}
		this.sampleCount = this.sampleLength / ((this.channels == 2) ? 2 : 1);
	}
	WAVStreamDecoder.prototype.extractChunk = function(desiredType, data) {
		data.position = 12;
		while (data.getBytesAvailable() > 8) {
			var chunkType = data.readString(4);
			var chunkSize = data.readUnsignedInt();
			if (chunkType == desiredType) {
				return data.extract(chunkSize);
			}
			data.position += chunkSize;
		}
		return null;
	}
	WAVStreamDecoder.prototype.readHeader = function() {
		var stream = this.stream;
		const riffStr = stream.readString(4);
		if (riffStr != 'RIFF') {
			throw new Error('WAVFile: bad file header');
		}
		const lengthInHeader = stream.readInt();
		if (stream.getLength() != (lengthInHeader + 8)) {
			console.log("WAVFile: bad RIFF size; ignoring");
		}
		const wavStr = stream.readString(4);
		if (wavStr != 'WAVE') {
			throw new Error('WAVFile: not a WAVE file');
		}
		return { lengthInHeader };
	}
	WAVStreamDecoder.prototype.setChannels = function(buffer) {
		this.channelLeft = buffer.getChannelData(0);
		if (this.channels == 2) {
			this.channelRight = buffer.getChannelData(1);
		}
	}
	WAVStreamDecoder.prototype.getByteLength = function() {
		var stream = this.stream;
		return stream.getLength();
	}
	WAVStreamDecoder.prototype.getLoadedTime = function() {
		return (this.sampleIndex / this.sampleLength) * (this.sampleCount / this.rate);
	}
	WAVStreamDecoder.prototype.step = function() {
		if (this.isLoad) return;
		var d = Date.now();
		while ((Date.now() - d) < 10) {
			this.execudeSample();
			if (this.sampleIndex >= this.sampleLength) {
				this.isLoad = true;
				break;
			}
		}
	}
	WAVStreamDecoder.prototype.writeSample = function(channel, id, sample) {
		var ch = (channel == 1) ? this.channelRight : this.channelLeft;
		ch[id] = sample;
	}
	WAVStreamDecoder.prototype.getSample8Uncompressed = function() {
		var compressedData = this.compressedData;
		var sample = compressedData.readUnsignedByte() - 128;
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), sample / 128);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample16Uncompressed = function() {
		var compressedData = this.compressedData;
		var sample = compressedData.readShort();
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), sample / 32767);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample24Uncompressed = function() {
		var compressedData = this.compressedData;
		var b24 = compressedData.readUnsignedByte();
		b24 += (compressedData.readUnsignedByte() * 0x100);
		b24 += (compressedData.readUnsignedByte() * 0x10000);
		if (b24 > 8388607) b24 -= 0x1000000;
		var sample = b24;
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), sample / 8388607);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample32Uncompressed = function() {
		var compressedData = this.compressedData;
		var sample = compressedData.readInt();
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), sample / 2147483647);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample64Uncompressed = function() {
		var compressedData = this.compressedData;
		compressedData.readInt(); // skip
		var sample = compressedData.readInt();
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), sample / 2147483647);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample32UncompressedFloat = function() {
		var compressedData = this.compressedData;
		var f = compressedData.readFloat();
		if (f > 1) f = 1;
		if (f < -1) f = -1;
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), f);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSample64UncompressedFloat = function() {
		var compressedData = this.compressedData;
		var f = compressedData.readDouble();
		if (f > 1) f = 1;
		if (f < -1) f = -1;
		this.writeSample(this.sampleIndex % this.channels, Math.floor(this.sampleIndex / this.channels), f);
		this.sampleIndex++;
	}
	WAVStreamDecoder.prototype.getSampleADPCM = function() {
		var compressedData = this.compressedData;
		const size = this.sampleLength;
		const samplesAfterBlockHeader = (this.adpcmBlockSize - 4) * 2;
		var code;
		if (this.channels == 2) {
			var lastByte = -1;
			var chan = [{ sample: 0, index: 0 }, { sample: 0, index: 0 }];
			chan[0].sample = compressedData.readShort();
			chan[0].index = compressedData.readUnsignedByte();
			compressedData.position++;
			chan[1].sample = compressedData.readShort();
			chan[1].index = compressedData.readUnsignedByte();
			compressedData.position++;
			if (chan[1].index > 88) chan[1].index = 88;
			if (chan[1].index > 88) chan[1].index = 88;
			this.writeSample(0, this.sampleIndex++, chan[0].sample / 32768);
			this.writeSample(1, this.sampleIndex++, chan[1].sample / 32768);
			var blockLength = Math.min(samplesAfterBlockHeader, size - this.sampleIndex);
			var blockStart = this.sampleIndex;
			while ((this.sampleIndex - blockStart) < (blockLength * 2)) {
				for (let g = 0; g < 2; g++) {
					var chs = chan[g];
					for (let h = 0; h < 8; h++) {
						if (lastByte < 0) {
							lastByte = compressedData.readUnsignedByte();
							code = lastByte & 0xF;
						} else {
							code = (lastByte >> 4) & 0xF;
							lastByte = -1;
						}
						var delta = WAVStreamDecoder.deltaDecoder(chs.index, code);
						chs.index += WAVStreamDecoder.INDEX_TABLE[code];
						if (chs.index > 88) chs.index = 88;
						if (chs.index < 0) chs.index = 0;
						chs.sample += delta;
						if (chs.sample > 32767) chs.sample = 32767;
						if (chs.sample < -32768) chs.sample = -32768;
						this.writeSample(g, Math.floor(this.sampleIndex / 2) + h, chs.sample / 32768);
					}
				}
				this.sampleIndex += 16;
			}
		} else {
			var lastByte = -1;
			var sample = compressedData.readShort();
			var index = compressedData.readUnsignedByte();
			compressedData.position++;
			if (index > 88) index = 88;
			this.writeSample(0, this.sampleIndex++, sample / 32768);
			var blockLength = Math.min(samplesAfterBlockHeader, size - this.sampleIndex);
			var blockStart = this.sampleIndex;
			while (this.sampleIndex - blockStart < blockLength) {
				if (lastByte < 0) {
					lastByte = compressedData.readUnsignedByte();
					code = lastByte & 0xF;
				} else {
					code = (lastByte >> 4) & 0xF;
					lastByte = -1;
				}
				var delta = WAVStreamDecoder.deltaDecoder(index, code);
				index += WAVStreamDecoder.INDEX_TABLE[code];
				if (index > 88) index = 88;
				if (index < 0) index = 0;
				sample += delta;
				if (sample > 32767) sample = 32767;
				if (sample < -32768) sample = -32768;
				this.writeSample(0, this.sampleIndex++, sample / 32768);
			}
		}
	}
	function util_len(v) {
		if (typeof(v) === 'object') return v.length;
		return 0;
	}
	function makeArray(lengths, Type) {
		if (!Type) Type = Float64Array;
		if (lengths.length === 1) {
			return new Type(lengths[0]);
		}
		var ret = [], len = lengths[0];
		for (var j = 0; j < len; j++) {
			ret[j] = makeArray(lengths.slice(1), Type);
		}
		return ret;
	}
	function init2dArray(root, prop, first, second) {
		root[prop] = makeArray([first, second]);
	}
	function init3dArray(root, prop, first, second, third) {
		root[prop] = makeArray([first, second, third]);
	}
	function init4dArray(root, prop, first, second, third, fourth) {
		root[prop] = makeArray([first, second, third, fourth]);
	}
	function concatTypedArrays(a, b) {
		var c = new (a.constructor)(a.length + b.length);
		c.set(a, 0);
		c.set(b, a.length);
		return c;
	}
	function concatBuffers(a, b) {
		return concatTypedArrays(new Uint8Array((!!a ? a.buffer : new ArrayBuffer(0)) || a), new Uint8Array((!!b ? b.buffer : new ArrayBuffer(0)) || b)).buffer;
	}
	const MP3FrameHeader  = function() {
		this.layer = -1;
		this.version = -1;
		this.mode = -1;
		this.rate = -1;
		this.header = 0;
		this.bitrate = 0;
		this.samplingRate = 0;
		this.paddingBit = 0;
	}
	MP3FrameHeader.versionTable = [2.5, -1, 2, 1];
	MP3FrameHeader.layerTable = [-1, 3, 2, 1];
	MP3FrameHeader.samplingRateTable = [44100, 48000, 32000];
	MP3FrameHeader.bitRateTable1 = [-1, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
	MP3FrameHeader.bitRateTable2 = [-1, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
	MP3FrameHeader.prototype.parseHeader = function(header) {
		this.header = header;
		this.version = MP3FrameHeader.versionTable[this.getVersionIndex(header)];
		this.layer = MP3FrameHeader.layerTable[this.getLayerIndex(header)];
		this.mode = this.getModeIndex(header);
		this.rate = this.getRateIndex(header);
		this.bitrate = this.getBitrateIndex(header);
		this.paddingBit = this.getPaddingBit(header);
		var samplingRate = MP3FrameHeader.samplingRateTable[this.rate];
		if (this.version == 2) samplingRate /= 2;
		if (this.version == 2.5) samplingRate /= 4;
		this.samplingRate = samplingRate;
		this.bitRateTable = (this.version == 1) ? MP3FrameHeader.bitRateTable1 : MP3FrameHeader.bitRateTable2;
		this.bitRateMultiplier = (this.version == 1) ? 144000 : 72000;
	}
	MP3FrameHeader.prototype.numberOfChannels = function() {
		return (this.mode > 2) ? 1 : 2;
	}
	MP3FrameHeader.prototype.useMSStereo = function() {
		var header = this.header;
		if (this.mode !== 1) {
			return false;
		}
		return (this.getModeExtension(header) & 0x2) !== 0;
	}
	MP3FrameHeader.prototype.useIntensityStereo = function() {
		var header = this.header;
		if (this.mode !== 1) {
			return false;
		}
		return (this.getModeExtension(header) & 0x1) !== 0;
	}
	MP3FrameHeader.prototype.samplingFrequency = function() {
		return this.samplingRate;
	}
	MP3FrameHeader.prototype.getCRC = function() {
		return this.getCRCFlag(this.header);
	}
	MP3FrameHeader.prototype.frameSize = function() {
		var version = this.version;
		var bitRate = this.bitRateTable[this.bitrate];
		var unpaddedSize = ((this.bitRateMultiplier * bitRate) / this.samplingRate) | 0;
		return (unpaddedSize + this.paddingBit) | 0;
	}
	MP3FrameHeader.prototype.isValidHeader = function(header) {
		return ((this.getFrameSync(header) == 2047) && (this.getVersionIndex(header) != 1) && (this.getLayerIndex(header) != 0) && (this.getBitrateIndex(header) != 0) && (this.getBitrateIndex(header) != 15) && (this.getRateIndex(header) != 3) && (this.getEmphasisIndex(header) != 2));
	}
	MP3FrameHeader.prototype.getVersionIndex = function(h) {
		return ((h & 0x00180000) >>> 19) >>> 0;
	}
	MP3FrameHeader.prototype.getLayerIndex = function(h) {
		return ((h & 0x00060000) >>> 17) >>> 0;
	}
	MP3FrameHeader.prototype.getCRCFlag = function(h) {
		return ((h & 0x00010000) >>> 16) >>> 0;
	}
	MP3FrameHeader.prototype.getBitrateIndex = function(h) {
		return ((h & 0x0000f000) >>> 12) >>> 0;
	}
	MP3FrameHeader.prototype.getRateIndex = function(h) {
		return (((h & 0x00000c00) >>> 10) >>> 0);
	}
	MP3FrameHeader.prototype.getPaddingBit = function(h) {
		return ((h & 0x00000200) >>> 9) >>> 0;
	}
	MP3FrameHeader.prototype.getModeIndex = function(h) {
		return ((h & 0x000000c0) >>> 6) >>> 0;
	}
	MP3FrameHeader.prototype.getModeExtension = function(h) {
		return ((h & 0x00000030) >>> 4) >>> 0;
	}
	MP3FrameHeader.prototype.getEmphasisIndex = function(h) {
		return (h & 0x00000003) >>> 0;
	}
	MP3FrameHeader.prototype.copyright = function(h) {
		return ((h & 0x00000008) >>> 3) >>> 0;
	}
	MP3FrameHeader.prototype.getFrameSync = function(h) {
		return ((h >> 21) & 2047);
	}
	var huffmanTable = new Uint16Array([0x0201, 0x0000, 0x0201, 0x0010, 0x0201, 0x0001, 0x0011, 0x0201, 0x0000, 0x0401, 0x0201, 0x0010, 0x0001, 0x0201, 0x0011, 0x0401, 0x0201, 0x0020, 0x0021, 0x0201, 0x0012, 0x0201, 0x0002, 0x0022, 0x0401, 0x0201, 0x0000, 0x0001, 0x0201, 0x0011, 0x0201, 0x0010, 0x0401, 0x0201, 0x0020, 0x0021, 0x0201, 0x0012, 0x0201, 0x0002, 0x0022, 0x0201, 0x0000, 0x0401, 0x0201, 0x0010, 0x0001, 0x0201, 0x0011, 0x0801, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0021, 0x0012, 0x0801, 0x0401, 0x0201, 0x0022, 0x0030, 0x0201, 0x0003, 0x0013, 0x0201, 0x0031, 0x0201, 0x0032, 0x0201, 0x0023, 0x0033, 0x0601, 0x0401, 0x0201, 0x0000, 0x0010, 0x0011, 0x0601, 0x0201, 0x0001, 0x0201, 0x0020, 0x0021, 0x0601, 0x0201, 0x0012, 0x0201, 0x0002, 0x0022, 0x0401, 0x0201, 0x0031, 0x0013, 0x0401, 0x0201, 0x0030, 0x0032, 0x0201, 0x0023, 0x0201, 0x0003, 0x0033, 0x0201, 0x0000, 0x0401, 0x0201, 0x0010, 0x0001, 0x0801, 0x0201, 0x0011, 0x0401, 0x0201, 0x0020, 0x0002, 0x0021, 0x1201, 0x0601, 0x0201, 0x0012, 0x0201, 0x0022, 0x0030, 0x0401, 0x0201, 0x0031, 0x0013, 0x0401, 0x0201, 0x0003, 0x0032, 0x0201, 0x0023, 0x0004, 0x0a01, 0x0401, 0x0201, 0x0040, 0x0041, 0x0201, 0x0014, 0x0201, 0x0042, 0x0024, 0x0c01, 0x0601, 0x0401, 0x0201, 0x0033, 0x0043, 0x0050, 0x0401, 0x0201, 0x0034, 0x0005, 0x0051, 0x0601, 0x0201, 0x0015, 0x0201, 0x0052, 0x0025, 0x0401, 0x0201, 0x0044, 0x0035, 0x0401, 0x0201, 0x0053, 0x0054, 0x0201, 0x0045, 0x0055, 0x0601, 0x0201, 0x0000, 0x0201, 0x0010, 0x0001, 0x0201, 0x0011, 0x0401, 0x0201, 0x0021, 0x0012, 0x0e01, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0022, 0x0401, 0x0201, 0x0030, 0x0003, 0x0201, 0x0031, 0x0013, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0032, 0x0023, 0x0201, 0x0040, 0x0004, 0x0201, 0x0041, 0x0201, 0x0014, 0x0042, 0x0c01, 0x0601, 0x0201, 0x0024, 0x0201, 0x0033, 0x0050, 0x0401, 0x0201, 0x0043, 0x0034, 0x0051, 0x0601, 0x0201, 0x0015, 0x0201, 0x0005, 0x0052, 0x0601, 0x0201, 0x0025, 0x0201, 0x0044, 0x0035, 0x0201, 0x0053, 0x0201, 0x0045, 0x0201, 0x0054, 0x0055, 0x0801, 0x0401, 0x0201, 0x0000, 0x0010, 0x0201, 0x0001, 0x0011, 0x0a01, 0x0401, 0x0201, 0x0020, 0x0021, 0x0201, 0x0012, 0x0201, 0x0002, 0x0022, 0x0c01, 0x0601, 0x0401, 0x0201, 0x0030, 0x0003, 0x0031, 0x0201, 0x0013, 0x0201, 0x0032, 0x0023, 0x0c01, 0x0401, 0x0201, 0x0041, 0x0014, 0x0401, 0x0201, 0x0040, 0x0033, 0x0201, 0x0042, 0x0024, 0x0a01, 0x0601, 0x0401, 0x0201, 0x0004, 0x0050, 0x0043, 0x0201, 0x0034, 0x0051, 0x0801, 0x0401, 0x0201, 0x0015, 0x0052, 0x0201, 0x0025, 0x0044, 0x0601, 0x0401, 0x0201, 0x0005, 0x0054, 0x0053, 0x0201, 0x0035, 0x0201, 0x0045, 0x0055, 0x0201, 0x0000, 0x0401, 0x0201, 0x0010, 0x0001, 0x0a01, 0x0201, 0x0011, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0021, 0x0012, 0x1c01, 0x0801, 0x0401, 0x0201, 0x0022, 0x0030, 0x0201, 0x0031, 0x0013, 0x0801, 0x0401, 0x0201, 0x0003, 0x0032, 0x0201, 0x0023, 0x0040, 0x0401, 0x0201, 0x0041, 0x0014, 0x0401, 0x0201, 0x0004, 0x0033, 0x0201, 0x0042, 0x0024, 0x1c01, 0x0a01, 0x0601, 0x0401, 0x0201, 0x0050, 0x0005, 0x0060, 0x0201, 0x0061, 0x0016, 0x0c01, 0x0601, 0x0401, 0x0201, 0x0043, 0x0034, 0x0051, 0x0201, 0x0015, 0x0201, 0x0052, 0x0025, 0x0401, 0x0201, 0x0026, 0x0036, 0x0071, 0x1401, 0x0801, 0x0201, 0x0017, 0x0401, 0x0201, 0x0044, 0x0053, 0x0006, 0x0601, 0x0401, 0x0201, 0x0035, 0x0045, 0x0062, 0x0201, 0x0070, 0x0201, 0x0007, 0x0064, 0x0e01, 0x0401, 0x0201, 0x0072, 0x0027, 0x0601, 0x0201, 0x0063, 0x0201, 0x0054, 0x0055, 0x0201, 0x0046, 0x0073, 0x0801, 0x0401, 0x0201, 0x0037, 0x0065, 0x0201, 0x0056, 0x0074, 0x0601, 0x0201, 0x0047, 0x0201, 0x0066, 0x0075, 0x0401, 0x0201, 0x0057, 0x0076, 0x0201, 0x0067, 0x0077, 0x0601, 0x0201, 0x0000, 0x0201, 0x0010, 0x0001, 0x0801, 0x0201, 0x0011, 0x0401, 0x0201, 0x0020, 0x0002, 0x0012, 0x1801, 0x0801, 0x0201, 0x0021, 0x0201, 0x0022, 0x0201, 0x0030, 0x0003, 0x0401, 0x0201, 0x0031, 0x0013, 0x0401, 0x0201, 0x0032, 0x0023, 0x0401, 0x0201, 0x0040, 0x0004, 0x0201, 0x0041, 0x0014, 0x1e01, 0x1001, 0x0a01, 0x0401, 0x0201, 0x0042, 0x0024, 0x0401, 0x0201, 0x0033, 0x0043, 0x0050, 0x0401, 0x0201, 0x0034, 0x0051, 0x0061, 0x0601, 0x0201, 0x0016, 0x0201, 0x0006, 0x0026, 0x0201, 0x0062, 0x0201, 0x0015, 0x0201, 0x0005, 0x0052, 0x1001, 0x0a01, 0x0601, 0x0401, 0x0201, 0x0025, 0x0044, 0x0060, 0x0201, 0x0063, 0x0036, 0x0401, 0x0201, 0x0070, 0x0017, 0x0071, 0x1001, 0x0601, 0x0401, 0x0201, 0x0007, 0x0064, 0x0072, 0x0201, 0x0027, 0x0401, 0x0201, 0x0053, 0x0035, 0x0201, 0x0054, 0x0045, 0x0a01, 0x0401, 0x0201, 0x0046, 0x0073, 0x0201, 0x0037, 0x0201, 0x0065, 0x0056, 0x0a01, 0x0601, 0x0401, 0x0201, 0x0055, 0x0057, 0x0074, 0x0201, 0x0047, 0x0066, 0x0401, 0x0201, 0x0075, 0x0076, 0x0201, 0x0067, 0x0077, 0x0c01, 0x0401, 0x0201, 0x0010, 0x0001, 0x0201, 0x0011, 0x0201, 0x0000, 0x0201, 0x0020, 0x0002, 0x1001, 0x0401, 0x0201, 0x0021, 0x0012, 0x0401, 0x0201, 0x0022, 0x0031, 0x0201, 0x0013, 0x0201, 0x0030, 0x0201, 0x0003, 0x0040, 0x1a01, 0x0801, 0x0401, 0x0201, 0x0032, 0x0023, 0x0201, 0x0041, 0x0033, 0x0a01, 0x0401, 0x0201, 0x0014, 0x0042, 0x0201, 0x0024, 0x0201, 0x0004, 0x0050, 0x0401, 0x0201, 0x0043, 0x0034, 0x0201, 0x0051, 0x0015, 0x1c01, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0052, 0x0025, 0x0201, 0x0053, 0x0035, 0x0401, 0x0201, 0x0060, 0x0016, 0x0061, 0x0401, 0x0201, 0x0062, 0x0026, 0x0601, 0x0401, 0x0201, 0x0005, 0x0006, 0x0044, 0x0201, 0x0054, 0x0045, 0x1201, 0x0a01, 0x0401, 0x0201, 0x0063, 0x0036, 0x0401, 0x0201, 0x0070, 0x0007, 0x0071, 0x0401, 0x0201, 0x0017, 0x0064, 0x0201, 0x0046, 0x0072, 0x0a01, 0x0601, 0x0201, 0x0027, 0x0201, 0x0055, 0x0073, 0x0201, 0x0037, 0x0056, 0x0801, 0x0401, 0x0201, 0x0065, 0x0074, 0x0201, 0x0047, 0x0066, 0x0401, 0x0201, 0x0075, 0x0057, 0x0201, 0x0076, 0x0201, 0x0067, 0x0077, 0x0201, 0x0000, 0x0601, 0x0201, 0x0010, 0x0201, 0x0001, 0x0011, 0x1c01, 0x0801, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0021, 0x0012, 0x0801, 0x0401, 0x0201, 0x0022, 0x0030, 0x0201, 0x0003, 0x0031, 0x0601, 0x0201, 0x0013, 0x0201, 0x0032, 0x0023, 0x0401, 0x0201, 0x0040, 0x0004, 0x0041, 0x4601, 0x1c01, 0x0e01, 0x0601, 0x0201, 0x0014, 0x0201, 0x0033, 0x0042, 0x0401, 0x0201, 0x0024, 0x0050, 0x0201, 0x0043, 0x0034, 0x0401, 0x0201, 0x0051, 0x0015, 0x0401, 0x0201, 0x0005, 0x0052, 0x0201, 0x0025, 0x0201, 0x0044, 0x0053, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0060, 0x0006, 0x0201, 0x0061, 0x0016, 0x0401, 0x0201, 0x0080, 0x0008, 0x0081, 0x1001, 0x0801, 0x0401, 0x0201, 0x0035, 0x0062, 0x0201, 0x0026, 0x0054, 0x0401, 0x0201, 0x0045, 0x0063, 0x0201, 0x0036, 0x0070, 0x0601, 0x0401, 0x0201, 0x0007, 0x0055, 0x0071, 0x0201, 0x0017, 0x0201, 0x0027, 0x0037, 0x4801, 0x1801, 0x0c01, 0x0401, 0x0201, 0x0018, 0x0082, 0x0201, 0x0028, 0x0401, 0x0201, 0x0064, 0x0046, 0x0072, 0x0801, 0x0401, 0x0201, 0x0084, 0x0048, 0x0201, 0x0090, 0x0009, 0x0201, 0x0091, 0x0019, 0x1801, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0073, 0x0065, 0x0201, 0x0056, 0x0074, 0x0401, 0x0201, 0x0047, 0x0066, 0x0083, 0x0601, 0x0201, 0x0038, 0x0201, 0x0075, 0x0057, 0x0201, 0x0092, 0x0029, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0067, 0x0085, 0x0201, 0x0058, 0x0039, 0x0201, 0x0093, 0x0201, 0x0049, 0x0086, 0x0601, 0x0201, 0x00a0, 0x0201, 0x0068, 0x000a, 0x0201, 0x00a1, 0x001a, 0x4401, 0x1801, 0x0c01, 0x0401, 0x0201, 0x00a2, 0x002a, 0x0401, 0x0201, 0x0095, 0x0059, 0x0201, 0x00a3, 0x003a, 0x0801, 0x0401, 0x0201, 0x004a, 0x0096, 0x0201, 0x00b0, 0x000b, 0x0201, 0x00b1, 0x001b, 0x1401, 0x0801, 0x0201, 0x00b2, 0x0401, 0x0201, 0x0076, 0x0077, 0x0094, 0x0601, 0x0401, 0x0201, 0x0087, 0x0078, 0x00a4, 0x0401, 0x0201, 0x0069, 0x00a5, 0x002b, 0x0c01, 0x0601, 0x0401, 0x0201, 0x005a, 0x0088, 0x00b3, 0x0201, 0x003b, 0x0201, 0x0079, 0x00a6, 0x0601, 0x0401, 0x0201, 0x006a, 0x00b4, 0x00c0, 0x0401, 0x0201, 0x000c, 0x0098, 0x00c1, 0x3c01, 0x1601, 0x0a01, 0x0601, 0x0201, 0x001c, 0x0201, 0x0089, 0x00b5, 0x0201, 0x005b, 0x00c2, 0x0401, 0x0201, 0x002c, 0x003c, 0x0401, 0x0201, 0x00b6, 0x006b, 0x0201, 0x00c4, 0x004c, 0x1001, 0x0801, 0x0401, 0x0201, 0x00a8, 0x008a, 0x0201, 0x00d0, 0x000d, 0x0201, 0x00d1, 0x0201, 0x004b, 0x0201, 0x0097, 0x00a7, 0x0c01, 0x0601, 0x0201, 0x00c3, 0x0201, 0x007a, 0x0099, 0x0401, 0x0201, 0x00c5, 0x005c, 0x00b7, 0x0401, 0x0201, 0x001d, 0x00d2, 0x0201, 0x002d, 0x0201, 0x007b, 0x00d3, 0x3401, 0x1c01, 0x0c01, 0x0401, 0x0201, 0x003d, 0x00c6, 0x0401, 0x0201, 0x006c, 0x00a9, 0x0201, 0x009a, 0x00d4, 0x0801, 0x0401, 0x0201, 0x00b8, 0x008b, 0x0201, 0x004d, 0x00c7, 0x0401, 0x0201, 0x007c, 0x00d5, 0x0201, 0x005d, 0x00e0, 0x0a01, 0x0401, 0x0201, 0x00e1, 0x001e, 0x0401, 0x0201, 0x000e, 0x002e, 0x00e2, 0x0801, 0x0401, 0x0201, 0x00e3, 0x006d, 0x0201, 0x008c, 0x00e4, 0x0401, 0x0201, 0x00e5, 0x00ba, 0x00f0, 0x2601, 0x1001, 0x0401, 0x0201, 0x00f1, 0x001f, 0x0601, 0x0401, 0x0201, 0x00aa, 0x009b, 0x00b9, 0x0201, 0x003e, 0x0201, 0x00d6, 0x00c8, 0x0c01, 0x0601, 0x0201, 0x004e, 0x0201, 0x00d7, 0x007d, 0x0201, 0x00ab, 0x0201, 0x005e, 0x00c9, 0x0601, 0x0201, 0x000f, 0x0201, 0x009c, 0x006e, 0x0201, 0x00f2, 0x002f, 0x2001, 0x1001, 0x0601, 0x0401, 0x0201, 0x00d8, 0x008d, 0x003f, 0x0601, 0x0201, 0x00f3, 0x0201, 0x00e6, 0x00ca, 0x0201, 0x00f4, 0x004f, 0x0801, 0x0401, 0x0201, 0x00bb, 0x00ac, 0x0201, 0x00e7, 0x00f5, 0x0401, 0x0201, 0x00d9, 0x009d, 0x0201, 0x005f, 0x00e8, 0x1e01, 0x0c01, 0x0601, 0x0201, 0x006f, 0x0201, 0x00f6, 0x00cb, 0x0401, 0x0201, 0x00bc, 0x00ad, 0x00da, 0x0801, 0x0201, 0x00f7, 0x0401, 0x0201, 0x007e, 0x007f, 0x008e, 0x0601, 0x0401, 0x0201, 0x009e, 0x00ae, 0x00cc, 0x0201, 0x00f8, 0x008f, 0x1201, 0x0801, 0x0401, 0x0201, 0x00db, 0x00bd, 0x0201, 0x00ea, 0x00f9, 0x0401, 0x0201, 0x009f, 0x00eb, 0x0201, 0x00be, 0x0201, 0x00cd, 0x00fa, 0x0e01, 0x0401, 0x0201, 0x00dd, 0x00ec, 0x0601, 0x0401, 0x0201, 0x00e9, 0x00af, 0x00dc, 0x0201, 0x00ce, 0x00fb, 0x0801, 0x0401, 0x0201, 0x00bf, 0x00de, 0x0201, 0x00cf, 0x00ee, 0x0401, 0x0201, 0x00df, 0x00ef, 0x0201, 0x00ff, 0x0201, 0x00ed, 0x0201, 0x00fd, 0x0201, 0x00fc, 0x00fe, 0x1001, 0x0601, 0x0201, 0x0000, 0x0201, 0x0010, 0x0001, 0x0201, 0x0011, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0021, 0x0012, 0x3201, 0x1001, 0x0601, 0x0201, 0x0022, 0x0201, 0x0030, 0x0031, 0x0601, 0x0201, 0x0013, 0x0201, 0x0003, 0x0040, 0x0201, 0x0032, 0x0023, 0x0e01, 0x0601, 0x0401, 0x0201, 0x0004, 0x0014, 0x0041, 0x0401, 0x0201, 0x0033, 0x0042, 0x0201, 0x0024, 0x0043, 0x0a01, 0x0601, 0x0201, 0x0034, 0x0201, 0x0050, 0x0005, 0x0201, 0x0051, 0x0015, 0x0401, 0x0201, 0x0052, 0x0025, 0x0401, 0x0201, 0x0044, 0x0053, 0x0061, 0x5a01, 0x2401, 0x1201, 0x0a01, 0x0601, 0x0201, 0x0035, 0x0201, 0x0060, 0x0006, 0x0201, 0x0016, 0x0062, 0x0401, 0x0201, 0x0026, 0x0054, 0x0201, 0x0045, 0x0063, 0x0a01, 0x0601, 0x0201, 0x0036, 0x0201, 0x0070, 0x0007, 0x0201, 0x0071, 0x0055, 0x0401, 0x0201, 0x0017, 0x0064, 0x0201, 0x0072, 0x0027, 0x1801, 0x1001, 0x0801, 0x0401, 0x0201, 0x0046, 0x0073, 0x0201, 0x0037, 0x0065, 0x0401, 0x0201, 0x0056, 0x0080, 0x0201, 0x0008, 0x0074, 0x0401, 0x0201, 0x0081, 0x0018, 0x0201, 0x0082, 0x0028, 0x1001, 0x0801, 0x0401, 0x0201, 0x0047, 0x0066, 0x0201, 0x0083, 0x0038, 0x0401, 0x0201, 0x0075, 0x0057, 0x0201, 0x0084, 0x0048, 0x0601, 0x0401, 0x0201, 0x0090, 0x0019, 0x0091, 0x0401, 0x0201, 0x0092, 0x0076, 0x0201, 0x0067, 0x0029, 0x5c01, 0x2401, 0x1201, 0x0a01, 0x0401, 0x0201, 0x0085, 0x0058, 0x0401, 0x0201, 0x0009, 0x0077, 0x0093, 0x0401, 0x0201, 0x0039, 0x0094, 0x0201, 0x0049, 0x0086, 0x0a01, 0x0601, 0x0201, 0x0068, 0x0201, 0x00a0, 0x000a, 0x0201, 0x00a1, 0x001a, 0x0401, 0x0201, 0x00a2, 0x002a, 0x0201, 0x0095, 0x0059, 0x1a01, 0x0e01, 0x0601, 0x0201, 0x00a3, 0x0201, 0x003a, 0x0087, 0x0401, 0x0201, 0x0078, 0x00a4, 0x0201, 0x004a, 0x0096, 0x0601, 0x0401, 0x0201, 0x0069, 0x00b0, 0x00b1, 0x0401, 0x0201, 0x001b, 0x00a5, 0x00b2, 0x0e01, 0x0801, 0x0401, 0x0201, 0x005a, 0x002b, 0x0201, 0x0088, 0x0097, 0x0201, 0x00b3, 0x0201, 0x0079, 0x003b, 0x0801, 0x0401, 0x0201, 0x006a, 0x00b4, 0x0201, 0x004b, 0x00c1, 0x0401, 0x0201, 0x0098, 0x0089, 0x0201, 0x001c, 0x00b5, 0x5001, 0x2201, 0x1001, 0x0601, 0x0401, 0x0201, 0x005b, 0x002c, 0x00c2, 0x0601, 0x0401, 0x0201, 0x000b, 0x00c0, 0x00a6, 0x0201, 0x00a7, 0x007a, 0x0a01, 0x0401, 0x0201, 0x00c3, 0x003c, 0x0401, 0x0201, 0x000c, 0x0099, 0x00b6, 0x0401, 0x0201, 0x006b, 0x00c4, 0x0201, 0x004c, 0x00a8, 0x1401, 0x0a01, 0x0401, 0x0201, 0x008a, 0x00c5, 0x0401, 0x0201, 0x00d0, 0x005c, 0x00d1, 0x0401, 0x0201, 0x00b7, 0x007b, 0x0201, 0x001d, 0x0201, 0x000d, 0x002d, 0x0c01, 0x0401, 0x0201, 0x00d2, 0x00d3, 0x0401, 0x0201, 0x003d, 0x00c6, 0x0201, 0x006c, 0x00a9, 0x0601, 0x0401, 0x0201, 0x009a, 0x00b8, 0x00d4, 0x0401, 0x0201, 0x008b, 0x004d, 0x0201, 0x00c7, 0x007c, 0x4401, 0x2201, 0x1201, 0x0a01, 0x0401, 0x0201, 0x00d5, 0x005d, 0x0401, 0x0201, 0x00e0, 0x000e, 0x00e1, 0x0401, 0x0201, 0x001e, 0x00e2, 0x0201, 0x00aa, 0x002e, 0x0801, 0x0401, 0x0201, 0x00b9, 0x009b, 0x0201, 0x00e3, 0x00d6, 0x0401, 0x0201, 0x006d, 0x003e, 0x0201, 0x00c8, 0x008c, 0x1001, 0x0801, 0x0401, 0x0201, 0x00e4, 0x004e, 0x0201, 0x00d7, 0x007d, 0x0401, 0x0201, 0x00e5, 0x00ba, 0x0201, 0x00ab, 0x005e, 0x0801, 0x0401, 0x0201, 0x00c9, 0x009c, 0x0201, 0x00f1, 0x001f, 0x0601, 0x0401, 0x0201, 0x00f0, 0x006e, 0x00f2, 0x0201, 0x002f, 0x00e6, 0x2601, 0x1201, 0x0801, 0x0401, 0x0201, 0x00d8, 0x00f3, 0x0201, 0x003f, 0x00f4, 0x0601, 0x0201, 0x004f, 0x0201, 0x008d, 0x00d9, 0x0201, 0x00bb, 0x00ca, 0x0801, 0x0401, 0x0201, 0x00ac, 0x00e7, 0x0201, 0x007e, 0x00f5, 0x0801, 0x0401, 0x0201, 0x009d, 0x005f, 0x0201, 0x00e8, 0x008e, 0x0201, 0x00f6, 0x00cb, 0x2201, 0x1201, 0x0a01, 0x0601, 0x0401, 0x0201, 0x000f, 0x00ae, 0x006f, 0x0201, 0x00bc, 0x00da, 0x0401, 0x0201, 0x00ad, 0x00f7, 0x0201, 0x007f, 0x00e9, 0x0801, 0x0401, 0x0201, 0x009e, 0x00cc, 0x0201, 0x00f8, 0x008f, 0x0401, 0x0201, 0x00db, 0x00bd, 0x0201, 0x00ea, 0x00f9, 0x1001, 0x0801, 0x0401, 0x0201, 0x009f, 0x00dc, 0x0201, 0x00cd, 0x00eb, 0x0401, 0x0201, 0x00be, 0x00fa, 0x0201, 0x00af, 0x00dd, 0x0e01, 0x0601, 0x0401, 0x0201, 0x00ec, 0x00ce, 0x00fb, 0x0401, 0x0201, 0x00bf, 0x00ed, 0x0201, 0x00de, 0x00fc, 0x0601, 0x0401, 0x0201, 0x00cf, 0x00fd, 0x00ee, 0x0401, 0x0201, 0x00df, 0x00fe, 0x0201, 0x00ef, 0x00ff, 0x0201, 0x0000, 0x0601, 0x0201, 0x0010, 0x0201, 0x0001, 0x0011, 0x2a01, 0x0801, 0x0401, 0x0201, 0x0020, 0x0002, 0x0201, 0x0021, 0x0012, 0x0a01, 0x0601, 0x0201, 0x0022, 0x0201, 0x0030, 0x0003, 0x0201, 0x0031, 0x0013, 0x0a01, 0x0401, 0x0201, 0x0032, 0x0023, 0x0401, 0x0201, 0x0040, 0x0004, 0x0041, 0x0601, 0x0201, 0x0014, 0x0201, 0x0033, 0x0042, 0x0401, 0x0201, 0x0024, 0x0050, 0x0201, 0x0043, 0x0034, 0x8a01, 0x2801, 0x1001, 0x0601, 0x0401, 0x0201, 0x0005, 0x0015, 0x0051, 0x0401, 0x0201, 0x0052, 0x0025, 0x0401, 0x0201, 0x0044, 0x0035, 0x0053, 0x0a01, 0x0601, 0x0401, 0x0201, 0x0060, 0x0006, 0x0061, 0x0201, 0x0016, 0x0062, 0x0801, 0x0401, 0x0201, 0x0026, 0x0054, 0x0201, 0x0045, 0x0063, 0x0401, 0x0201, 0x0036, 0x0070, 0x0071, 0x2801, 0x1201, 0x0801, 0x0201, 0x0017, 0x0201, 0x0007, 0x0201, 0x0055, 0x0064, 0x0401, 0x0201, 0x0072, 0x0027, 0x0401, 0x0201, 0x0046, 0x0065, 0x0073, 0x0a01, 0x0601, 0x0201, 0x0037, 0x0201, 0x0056, 0x0008, 0x0201, 0x0080, 0x0081, 0x0601, 0x0201, 0x0018, 0x0201, 0x0074, 0x0047, 0x0201, 0x0082, 0x0201, 0x0028, 0x0066, 0x1801, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0083, 0x0038, 0x0201, 0x0075, 0x0084, 0x0401, 0x0201, 0x0048, 0x0090, 0x0091, 0x0601, 0x0201, 0x0019, 0x0201, 0x0009, 0x0076, 0x0201, 0x0092, 0x0029, 0x0e01, 0x0801, 0x0401, 0x0201, 0x0085, 0x0058, 0x0201, 0x0093, 0x0039, 0x0401, 0x0201, 0x00a0, 0x000a, 0x001a, 0x0801, 0x0201, 0x00a2, 0x0201, 0x0067, 0x0201, 0x0057, 0x0049, 0x0601, 0x0201, 0x0094, 0x0201, 0x0077, 0x0086, 0x0201, 0x00a1, 0x0201, 0x0068, 0x0095, 0xdc01, 0x7e01, 0x3201, 0x1a01, 0x0c01, 0x0601, 0x0201, 0x002a, 0x0201, 0x0059, 0x003a, 0x0201, 0x00a3, 0x0201, 0x0087, 0x0078, 0x0801, 0x0401, 0x0201, 0x00a4, 0x004a, 0x0201, 0x0096, 0x0069, 0x0401, 0x0201, 0x00b0, 0x000b, 0x00b1, 0x0a01, 0x0401, 0x0201, 0x001b, 0x00b2, 0x0201, 0x002b, 0x0201, 0x00a5, 0x005a, 0x0601, 0x0201, 0x00b3, 0x0201, 0x00a6, 0x006a, 0x0401, 0x0201, 0x00b4, 0x004b, 0x0201, 0x000c, 0x00c1, 0x1e01, 0x0e01, 0x0601, 0x0401, 0x0201, 0x00b5, 0x00c2, 0x002c, 0x0401, 0x0201, 0x00a7, 0x00c3, 0x0201, 0x006b, 0x00c4, 0x0801, 0x0201, 0x001d, 0x0401, 0x0201, 0x0088, 0x0097, 0x003b, 0x0401, 0x0201, 0x00d1, 0x00d2, 0x0201, 0x002d, 0x00d3, 0x1201, 0x0601, 0x0401, 0x0201, 0x001e, 0x002e, 0x00e2, 0x0601, 0x0401, 0x0201, 0x0079, 0x0098, 0x00c0, 0x0201, 0x001c, 0x0201, 0x0089, 0x005b, 0x0e01, 0x0601, 0x0201, 0x003c, 0x0201, 0x007a, 0x00b6, 0x0401, 0x0201, 0x004c, 0x0099, 0x0201, 0x00a8, 0x008a, 0x0601, 0x0201, 0x000d, 0x0201, 0x00c5, 0x005c, 0x0401, 0x0201, 0x003d, 0x00c6, 0x0201, 0x006c, 0x009a, 0x5801, 0x5601, 0x2401, 0x1001, 0x0801, 0x0401, 0x0201, 0x008b, 0x004d, 0x0201, 0x00c7, 0x007c, 0x0401, 0x0201, 0x00d5, 0x005d, 0x0201, 0x00e0, 0x000e, 0x0801, 0x0201, 0x00e3, 0x0401, 0x0201, 0x00d0, 0x00b7, 0x007b, 0x0601, 0x0401, 0x0201, 0x00a9, 0x00b8, 0x00d4, 0x0201, 0x00e1, 0x0201, 0x00aa, 0x00b9, 0x1801, 0x0a01, 0x0601, 0x0401, 0x0201, 0x009b, 0x00d6, 0x006d, 0x0201, 0x003e, 0x00c8, 0x0601, 0x0401, 0x0201, 0x008c, 0x00e4, 0x004e, 0x0401, 0x0201, 0x00d7, 0x00e5, 0x0201, 0x00ba, 0x00ab, 0x0c01, 0x0401, 0x0201, 0x009c, 0x00e6, 0x0401, 0x0201, 0x006e, 0x00d8, 0x0201, 0x008d, 0x00bb, 0x0801, 0x0401, 0x0201, 0x00e7, 0x009d, 0x0201, 0x00e8, 0x008e, 0x0401, 0x0201, 0x00cb, 0x00bc, 0x009e, 0x00f1, 0x0201, 0x001f, 0x0201, 0x000f, 0x002f, 0x4201, 0x3801, 0x0201, 0x00f2, 0x3401, 0x3201, 0x1401, 0x0801, 0x0201, 0x00bd, 0x0201, 0x005e, 0x0201, 0x007d, 0x00c9, 0x0601, 0x0201, 0x00ca, 0x0201, 0x00ac, 0x007e, 0x0401, 0x0201, 0x00da, 0x00ad, 0x00cc, 0x0a01, 0x0601, 0x0201, 0x00ae, 0x0201, 0x00db, 0x00dc, 0x0201, 0x00cd, 0x00be, 0x0601, 0x0401, 0x0201, 0x00eb, 0x00ed, 0x00ee, 0x0601, 0x0401, 0x0201, 0x00d9, 0x00ea, 0x00e9, 0x0201, 0x00de, 0x0401, 0x0201, 0x00dd, 0x00ec, 0x00ce, 0x003f, 0x00f0, 0x0401, 0x0201, 0x00f3, 0x00f4, 0x0201, 0x004f, 0x0201, 0x00f5, 0x005f, 0x0a01, 0x0201, 0x00ff, 0x0401, 0x0201, 0x00f6, 0x006f, 0x0201, 0x00f7, 0x007f, 0x0c01, 0x0601, 0x0201, 0x008f, 0x0201, 0x00f8, 0x00f9, 0x0401, 0x0201, 0x009f, 0x00fa, 0x00af, 0x0801, 0x0401, 0x0201, 0x00fb, 0x00bf, 0x0201, 0x00fc, 0x00cf, 0x0401, 0x0201, 0x00fd, 0x00df, 0x0201, 0x00fe, 0x00ef, 0x3c01, 0x0801, 0x0401, 0x0201, 0x0000, 0x0010, 0x0201, 0x0001, 0x0011, 0x0e01, 0x0601, 0x0401, 0x0201, 0x0020, 0x0002, 0x0021, 0x0201, 0x0012, 0x0201, 0x0022, 0x0201, 0x0030, 0x0003, 0x0e01, 0x0401, 0x0201, 0x0031, 0x0013, 0x0401, 0x0201, 0x0032, 0x0023, 0x0401, 0x0201, 0x0040, 0x0004, 0x0041, 0x0801, 0x0401, 0x0201, 0x0014, 0x0033, 0x0201, 0x0042, 0x0024, 0x0601, 0x0401, 0x0201, 0x0043, 0x0034, 0x0051, 0x0601, 0x0401, 0x0201, 0x0050, 0x0005, 0x0015, 0x0201, 0x0052, 0x0025, 0xfa01, 0x6201, 0x2201, 0x1201, 0x0a01, 0x0401, 0x0201, 0x0044, 0x0053, 0x0201, 0x0035, 0x0201, 0x0060, 0x0006, 0x0401, 0x0201, 0x0061, 0x0016, 0x0201, 0x0062, 0x0026, 0x0801, 0x0401, 0x0201, 0x0054, 0x0045, 0x0201, 0x0063, 0x0036, 0x0401, 0x0201, 0x0071, 0x0055, 0x0201, 0x0064, 0x0046, 0x2001, 0x0e01, 0x0601, 0x0201, 0x0072, 0x0201, 0x0027, 0x0037, 0x0201, 0x0073, 0x0401, 0x0201, 0x0070, 0x0007, 0x0017, 0x0a01, 0x0401, 0x0201, 0x0065, 0x0056, 0x0401, 0x0201, 0x0080, 0x0008, 0x0081, 0x0401, 0x0201, 0x0074, 0x0047, 0x0201, 0x0018, 0x0082, 0x1001, 0x0801, 0x0401, 0x0201, 0x0028, 0x0066, 0x0201, 0x0083, 0x0038, 0x0401, 0x0201, 0x0075, 0x0057, 0x0201, 0x0084, 0x0048, 0x0801, 0x0401, 0x0201, 0x0091, 0x0019, 0x0201, 0x0092, 0x0076, 0x0401, 0x0201, 0x0067, 0x0029, 0x0201, 0x0085, 0x0058, 0x5c01, 0x2201, 0x1001, 0x0801, 0x0401, 0x0201, 0x0093, 0x0039, 0x0201, 0x0094, 0x0049, 0x0401, 0x0201, 0x0077, 0x0086, 0x0201, 0x0068, 0x00a1, 0x0801, 0x0401, 0x0201, 0x00a2, 0x002a, 0x0201, 0x0095, 0x0059, 0x0401, 0x0201, 0x00a3, 0x003a, 0x0201, 0x0087, 0x0201, 0x0078, 0x004a, 0x1601, 0x0c01, 0x0401, 0x0201, 0x00a4, 0x0096, 0x0401, 0x0201, 0x0069, 0x00b1, 0x0201, 0x001b, 0x00a5, 0x0601, 0x0201, 0x00b2, 0x0201, 0x005a, 0x002b, 0x0201, 0x0088, 0x00b3, 0x1001, 0x0a01, 0x0601, 0x0201, 0x0090, 0x0201, 0x0009, 0x00a0, 0x0201, 0x0097, 0x0079, 0x0401, 0x0201, 0x00a6, 0x006a, 0x00b4, 0x0c01, 0x0601, 0x0201, 0x001a, 0x0201, 0x000a, 0x00b0, 0x0201, 0x003b, 0x0201, 0x000b, 0x00c0, 0x0401, 0x0201, 0x004b, 0x00c1, 0x0201, 0x0098, 0x0089, 0x4301, 0x2201, 0x1001, 0x0801, 0x0401, 0x0201, 0x001c, 0x00b5, 0x0201, 0x005b, 0x00c2, 0x0401, 0x0201, 0x002c, 0x00a7, 0x0201, 0x007a, 0x00c3, 0x0a01, 0x0601, 0x0201, 0x003c, 0x0201, 0x000c, 0x00d0, 0x0201, 0x00b6, 0x006b, 0x0401, 0x0201, 0x00c4, 0x004c, 0x0201, 0x0099, 0x00a8, 0x1001, 0x0801, 0x0401, 0x0201, 0x008a, 0x00c5, 0x0201, 0x005c, 0x00d1, 0x0401, 0x0201, 0x00b7, 0x007b, 0x0201, 0x001d, 0x00d2, 0x0901, 0x0401, 0x0201, 0x002d, 0x00d3, 0x0201, 0x003d, 0x00c6, 0x55fa, 0x0401, 0x0201, 0x006c, 0x00a9, 0x0201, 0x009a, 0x00d4, 0x2001, 0x1001, 0x0801, 0x0401, 0x0201, 0x00b8, 0x008b, 0x0201, 0x004d, 0x00c7, 0x0401, 0x0201, 0x007c, 0x00d5, 0x0201, 0x005d, 0x00e1, 0x0801, 0x0401, 0x0201, 0x001e, 0x00e2, 0x0201, 0x00aa, 0x00b9, 0x0401, 0x0201, 0x009b, 0x00e3, 0x0201, 0x00d6, 0x006d, 0x1401, 0x0a01, 0x0601, 0x0201, 0x003e, 0x0201, 0x002e, 0x004e, 0x0201, 0x00c8, 0x008c, 0x0401, 0x0201, 0x00e4, 0x00d7, 0x0401, 0x0201, 0x007d, 0x00ab, 0x00e5, 0x0a01, 0x0401, 0x0201, 0x00ba, 0x005e, 0x0201, 0x00c9, 0x0201, 0x009c, 0x006e, 0x0801, 0x0201, 0x00e6, 0x0201, 0x000d, 0x0201, 0x00e0, 0x000e, 0x0401, 0x0201, 0x00d8, 0x008d, 0x0201, 0x00bb, 0x00ca, 0x4a01, 0x0201, 0x00ff, 0x4001, 0x3a01, 0x2001, 0x1001, 0x0801, 0x0401, 0x0201, 0x00ac, 0x00e7, 0x0201, 0x007e, 0x00d9, 0x0401, 0x0201, 0x009d, 0x00e8, 0x0201, 0x008e, 0x00cb, 0x0801, 0x0401, 0x0201, 0x00bc, 0x00da, 0x0201, 0x00ad, 0x00e9, 0x0401, 0x0201, 0x009e, 0x00cc, 0x0201, 0x00db, 0x00bd, 0x1001, 0x0801, 0x0401, 0x0201, 0x00ea, 0x00ae, 0x0201, 0x00dc, 0x00cd, 0x0401, 0x0201, 0x00eb, 0x00be, 0x0201, 0x00dd, 0x00ec, 0x0801, 0x0401, 0x0201, 0x00ce, 0x00ed, 0x0201, 0x00de, 0x00ee, 0x000f, 0x0401, 0x0201, 0x00f0, 0x001f, 0x00f1, 0x0401, 0x0201, 0x00f2, 0x002f, 0x0201, 0x00f3, 0x003f, 0x1201, 0x0801, 0x0401, 0x0201, 0x00f4, 0x004f, 0x0201, 0x00f5, 0x005f, 0x0401, 0x0201, 0x00f6, 0x006f, 0x0201, 0x00f7, 0x0201, 0x007f, 0x008f, 0x0a01, 0x0401, 0x0201, 0x00f8, 0x00f9, 0x0401, 0x0201, 0x009f, 0x00af, 0x00fa, 0x0801, 0x0401, 0x0201, 0x00fb, 0x00bf, 0x0201, 0x00fc, 0x00cf, 0x0401, 0x0201, 0x00fd, 0x00df, 0x0201, 0x00fe, 0x00ef, 0x0201, 0x0000, 0x0801, 0x0401, 0x0201, 0x0008, 0x0004, 0x0201, 0x0001, 0x0002, 0x0801, 0x0401, 0x0201, 0x000c, 0x000a, 0x0201, 0x0003, 0x0006, 0x0601, 0x0201, 0x0009, 0x0201, 0x0005, 0x0007, 0x0401, 0x0201, 0x000e, 0x000d, 0x0201, 0x000f, 0x000b, 0x1001, 0x0801, 0x0401, 0x0201, 0x0000, 0x0001, 0x0201, 0x0002, 0x0003, 0x0401, 0x0201, 0x0004, 0x0005, 0x0201, 0x0006, 0x0007, 0x0801, 0x0401, 0x0201, 0x0008, 0x0009, 0x0201, 0x000a, 0x000b, 0x0401, 0x0201, 0x000c, 0x000d, 0x0201, 0x000e, 0x000f]);
	var huffmanMain = [{ hufftable: null, linbits: 0}, { hufftable: huffmanTable.subarray(0, 7), linbits: 0}, { hufftable: huffmanTable.subarray(7, (7 + 17)), linbits: 0}, { hufftable: huffmanTable.subarray(24, (24 + 17)), linbits: 0}, { hufftable: null, linbits: 0}, { hufftable: huffmanTable.subarray(41, (41 + 31)), linbits: 0}, { hufftable: huffmanTable.subarray(72, (72 + 31)), linbits: 0}, { hufftable: huffmanTable.subarray(103, (103 + 71)), linbits: 0}, { hufftable: huffmanTable.subarray(174, (174 + 71)), linbits: 0}, { hufftable: huffmanTable.subarray(245, (245 + 71)), linbits: 0}, { hufftable: huffmanTable.subarray(316, (316 + 127)), linbits: 0}, { hufftable: huffmanTable.subarray(443, (443 + 127)), linbits: 0}, { hufftable: huffmanTable.subarray(570, (570 + 127)), linbits: 0}, { hufftable: huffmanTable.subarray(697, (697 + 511)), linbits: 0}, { hufftable: null, linbits: 0}, { hufftable: huffmanTable.subarray(1208, (1208 + 511)), linbits: 0}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 1}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 2}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 3}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 4}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 6}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 8}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 10}, { hufftable: huffmanTable.subarray(1719, (1719 + 511)),  linbits: 13}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 4}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 5}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 6}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 7}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 8}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 9}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 11}, { hufftable: huffmanTable.subarray(2230, (2230 + 512)),  linbits: 13},{ hufftable: huffmanTable.subarray(2742, (2742 + 31)),  linbits: 0}, { hufftable: huffmanTable.subarray(2773, (2773 + 31)),  linbits: 0}];
	function huffman_decode(m, tableNum) {
		var x =0, y = 0 ,v = 0, w = 0;
		var point = 0;
		var error = 1;
		var bitsleft = 32;
		var hufftable = huffmanMain[tableNum].hufftable;
		var linbits = huffmanMain[tableNum].linbits;
		if (null === hufftable) return {x: 0, y: 0, v: 0, w: 0, err: null};
		while(true) {
			if ((hufftable[point] & 0xff00) >>> 0 === 0) {
				error = 0;
				x = (((hufftable[point] >>> 4) >>> 0) & 0xf) >>> 0;
				y = (hufftable[point] & 0xf) >>> 0;
				break;
			}
			if (m.Bit() !== 0) {
				while((hufftable[point] & 0xff) >>> 0 >= 250) point += ((hufftable[point] & 0xff) >>> 0);
				point += ((hufftable[point] & 0xff) >>> 0);
			} else {
				while(((hufftable[point] >>> 8) >>> 0) >= 250) point += (hufftable[point] >>> 8) >>> 0;
				point += (hufftable[point] >>> 8) >>> 0;
			}
			bitsleft--;
			if ((bitsleft <= 0) || (point >= hufftable.length)) break;
		}
		if (error !== 0) {
			console.log("mp3: illegal Huff code in data. bleft = " + bitsleft + ", point = " + point +". tab = " + tableNum + ".");
			return null;
		}
		if (tableNum > 31) {
			v = (((y >>> 3) >>> 0) & 1) >>> 0;
			w = (((y >>> 2) >>> 0) & 1) >>> 0;
			x = (((y >>> 1) >>> 0) & 1) >>> 0;
			y = (y & 1) >>> 0;
			if ((v !== 0) && (m.Bit() === 1)) v = -v;
			if ((w !== 0) && (m.Bit() === 1)) w = -w;
			if ((x !== 0) && (m.Bit() === 1)) x = -x;
			if ((y !== 0) && (m.Bit() === 1)) y = -y;
		} else {
			if ((linbits !== 0) && (x === 15)) x += m.Bits(linbits);
			if ((x !== 0) && (m.Bit() === 1)) x = -x;
			if ((linbits !== 0) && (y === 15)) y += m.Bits(linbits);
			if ((y !== 0) && (m.Bit() === 1)) y = -y;
		}
		return {x: x, y: y, v: v, w: w, err: null}
	}
	var getValue = function (dv, index) {
		if (index >= dv.byteLength) return 0;
		return dv.getUint8(index);
	};
	const BitStream = function(vec) {
		this.vec = vec;
		this.bitPos = 0;
		this.bytePos = 0;
	}
	BitStream.prototype.Bit = function() {
		if (this.vec.byteLength <= this.bytePos) return 0;
		var dv = new DataView(this.vec, this.bytePos);
		var tmp = (dv.getUint8(0) >>> (7 - this.bitPos)) >>> 0;
		tmp &= 0x01;
		this.bytePos += ((this.bitPos + 1) >>> 3) >>> 0;
		this.bitPos = (this.bitPos + 1) & 0x07;
		return tmp;
	}
	BitStream.prototype.Bits = function(num) {
		if (num === 0) return 0;
		if (this.vec.byteLength <= this.bytePos) return 0;
		var bb = new DataView(this.vec, this.bytePos);
		var tmp = (((getValue(bb, 0) << 24) >>> 0) | ((getValue(bb, 1) << 16) >>> 0) | ((getValue(bb, 2) << 8) >>> 0) | (getValue(bb, 3) >>> 0)) >>> 0;
		tmp = (tmp << this.bitPos) >>> 0;
		tmp = (tmp >>> (32 - num)) >>> 0;
		this.bytePos += ((this.bitPos + num) >>> 3) >>> 0;
		this.bitPos = (this.bitPos + num) & 0x07;
		return tmp;
	}
	BitStream.prototype.Tail = function(offset) {
		var a = new Uint8Array(this.vec);
		return a.slice(this.vec.byteLength - offset).buffer;
	}
	BitStream.prototype.LenInBytes = function() {
		return this.vec.byteLength;
	}
	BitStream.prototype.BitPos = function() {
		return ((this.bytePos << 3) >>> 0) + this.bitPos;
	}
	BitStream.prototype.SetPos = function(pos) {
		this.bytePos = (pos >>> 3) >>> 0;
		this.bitPos = (pos & 0x7) >>> 0;
	}
	BitStream.prototype.append = function(buf) {
		return new BitStream(this.vec.concat(buf));
	}
	var scalefacSizes = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3]];
	var imdctWinData = [new Float32Array(36), new Float32Array(36), new Float32Array(36), new Float32Array(36)];
	var cosN12 = [];
	for (var i = 0; i < 6; i++) {
		cosN12.push(new Float32Array(12));
	}
	var cosN36 = [];
	for (var i = 0; i < 18; i++) {
		cosN36.push(new Float32Array(36));
	}
	var init = function () {
		for (var i = 0; i < 36; i++) {
			imdctWinData[0][i] = Math.sin(Math.PI / 36 * (i + 0.5));
		}
		for (var i = 0; i < 18; i++) {
			imdctWinData[1][i] = Math.sin(Math.PI / 36 * (i + 0.5));
		}
		for (var i = 18; i < 24; i++) {
			imdctWinData[1][i] = 1.0;
		}
		for (var i = 24; i < 30; i++) {
			imdctWinData[1][i] = Math.sin(Math.PI / 12 * (i + 0.5 - 18.0));
		}
		for (var i = 30; i < 36; i++) {
			imdctWinData[1][i] = 0.0;
		}
		for (var i = 0; i < 12; i++) {
			imdctWinData[2][i] = Math.sin(Math.PI / 12 * (i + 0.5));
		}
		for (var i = 12; i < 36; i++) {
			imdctWinData[2][i] = 0.0;
		}
		for (var i = 0; i < 6; i++) {
			imdctWinData[3][i] = 0.0;
		}
		for (var i = 6; i < 12; i++) {
			imdctWinData[3][i] = Math.sin(Math.PI / 12 * (i + 0.5 - 6.0));
		}
		for (var i = 12; i < 18; i++) {
			imdctWinData[3][i] = 1.0;
		}
		for (var i = 18; i < 36; i++) {
			imdctWinData[3][i] = Math.sin(Math.PI / 36 * (i + 0.5));
		}
		const cosN12_N = 12
		for (var i = 0; i < 6; i++) {
			for (var j = 0; j < 12; j++) {
				cosN12[i][j] = Math.cos(Math.PI / (2 * cosN12_N) * (2*j + 1 + cosN12_N/2) * (2*i + 1));
			}
		}
		const cosN36_N = 36;
		for (var i = 0; i < 18; i++) {
			for (var j = 0; j < 36; j++) {
				cosN36[i][j] = Math.cos(Math.PI / (2 * cosN36_N) * (2*j + 1 + cosN36_N/2) * (2*i + 1));
			}
		}
	};
	init();
	var Imdct = {
		Win: function (inData, blockType) {
			var out = new Float32Array(36);
			if (blockType === 2) {
				var iwd = imdctWinData[blockType];
				const N = 12;
				for (var i = 0; i < 3; i++) {
					for (var p = 0; p < N; p++) {
						var sum = 0.0;
						for (var m = 0; m < N/2; m++) {
							sum += inData[i+3*m] * cosN12[m][p];
						}
						out[6*i+p+6] += sum * iwd[p];
					}
				}
				return out;
			}
			const N = 36;
			var iwd = imdctWinData[blockType];
			for (var p = 0; p < N; p++) {
				var sum = 0.0;
				for (var m = 0; m < N/2; m++) {
					sum += inData[m] * cosN36[m][p];
				}
				out[p] = sum * iwd[p];
			}
			return out;
		}
	};
	var SfBandIndicesSet = {
		0: { // SamplingFrequency44100
			L: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
			S: [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192]
		},
		1: { // SamplingFrequency48000
			L: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
			S: [0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192]
		},
		2: { // SamplingFrequency32000
			L: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
			S: [0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192]
		}
	}
	var powtab34 = new Float64Array(8207);
	var pretab_data = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 2, 0];
	var pretab = new Float64Array(pretab_data.length);
	pretab.set(pretab_data);
	for (var i = 0; i < powtab34.length; i++) {
		powtab34[i] = Math.pow(i, 4.0 / 3.0);
	}
	var synthNWin = [];
	for (var i = 0; i < 64; i++) {
		synthNWin.push(new Float32Array(32));
	}
	for (var i = 0; i < 64; i++) {
		for (var j = 0; j < 32; j++) {
			synthNWin[i][j] = Math.cos(((16 + i) * (2 * j + 1)) * (Math.PI / 64.0));
		}
	}
	var synthDtbl = new Float32Array([0.000000000, -0.000015259, -0.000015259, -0.000015259, -0.000015259, -0.000015259, -0.000015259, -0.000030518, -0.000030518, -0.000030518, -0.000030518, -0.000045776, -0.000045776, -0.000061035, -0.000061035, -0.000076294, -0.000076294, -0.000091553, -0.000106812, -0.000106812, -0.000122070, -0.000137329, -0.000152588, -0.000167847, -0.000198364, -0.000213623, -0.000244141, -0.000259399, -0.000289917, -0.000320435, -0.000366211, -0.000396729, -0.000442505, -0.000473022, -0.000534058, -0.000579834, -0.000625610, -0.000686646, -0.000747681, -0.000808716, -0.000885010, -0.000961304, -0.001037598, -0.001113892, -0.001205444, -0.001296997, -0.001388550, -0.001480103, -0.001586914, -0.001693726, -0.001785278, -0.001907349, -0.002014160, -0.002120972, -0.002243042, -0.002349854, -0.002456665, -0.002578735, -0.002685547, -0.002792358, -0.002899170, -0.002990723, -0.003082275, -0.003173828, 0.003250122, 0.003326416, 0.003387451, 0.003433228, 0.003463745, 0.003479004, 0.003479004, 0.003463745, 0.003417969, 0.003372192, 0.003280640, 0.003173828, 0.003051758, 0.002883911, 0.002700806, 0.002487183, 0.002227783, 0.001937866, 0.001617432, 0.001266479, 0.000869751, 0.000442505, -0.000030518, -0.000549316, -0.001098633, -0.001693726, -0.002334595, -0.003005981, -0.003723145, -0.004486084, -0.005294800, -0.006118774, -0.007003784, -0.007919312, -0.008865356, -0.009841919, -0.010848999, -0.011886597, -0.012939453, -0.014022827, -0.015121460, -0.016235352, -0.017349243, -0.018463135, -0.019577026, -0.020690918, -0.021789551, -0.022857666, -0.023910522, -0.024932861, -0.025909424, -0.026840210, -0.027725220, -0.028533936, -0.029281616, -0.029937744, -0.030532837, -0.031005859, -0.031387329, -0.031661987, -0.031814575, -0.031845093, -0.031738281, -0.031478882, 0.031082153, 0.030517578, 0.029785156, 0.028884888, 0.027801514, 0.026535034, 0.025085449, 0.023422241, 0.021575928, 0.019531250, 0.017257690, 0.014801025, 0.012115479, 0.009231567, 0.006134033, 0.002822876, -0.000686646, -0.004394531, -0.008316040, -0.012420654, -0.016708374, -0.021179199, -0.025817871, -0.030609131, -0.035552979, -0.040634155, -0.045837402, -0.051132202, -0.056533813, -0.061996460, -0.067520142, -0.073059082, -0.078628540, -0.084182739, -0.089706421, -0.095169067, -0.100540161, -0.105819702, -0.110946655, -0.115921021, -0.120697021, -0.125259399, -0.129562378, -0.133590698, -0.137298584, -0.140670776, -0.143676758, -0.146255493, -0.148422241, -0.150115967, -0.151306152, -0.151962280, -0.152069092, -0.151596069, -0.150497437, -0.148773193, -0.146362305, -0.143264771, -0.139450073, -0.134887695, -0.129577637, -0.123474121, -0.116577148, -0.108856201, 0.100311279, 0.090927124, 0.080688477, 0.069595337, 0.057617188, 0.044784546, 0.031082153, 0.016510010, 0.001068115, -0.015228271, -0.032379150, -0.050354004, -0.069168091, -0.088775635, -0.109161377, -0.130310059, -0.152206421, -0.174789429, -0.198059082, -0.221984863, -0.246505737, -0.271591187, -0.297210693, -0.323318481, -0.349868774, -0.376800537, -0.404083252, -0.431655884, -0.459472656, -0.487472534, -0.515609741, -0.543823242, -0.572036743, -0.600219727, -0.628295898, -0.656219482, -0.683914185, -0.711318970, -0.738372803, -0.765029907, -0.791213989, -0.816864014, -0.841949463, -0.866363525, -0.890090942, -0.913055420, -0.935195923, -0.956481934, -0.976852417, -0.996246338, -1.014617920, -1.031936646, -1.048156738, -1.063217163, -1.077117920, -1.089782715, -1.101211548, -1.111373901, -1.120223999, -1.127746582, -1.133926392, -1.138763428, -1.142211914, -1.144287109, 1.144989014, 1.144287109, 1.142211914, 1.138763428, 1.133926392, 1.127746582, 1.120223999, 1.111373901, 1.101211548, 1.089782715, 1.077117920, 1.063217163, 1.048156738, 1.031936646, 1.014617920, 0.996246338, 0.976852417, 0.956481934, 0.935195923, 0.913055420, 0.890090942, 0.866363525, 0.841949463, 0.816864014, 0.791213989, 0.765029907, 0.738372803, 0.711318970, 0.683914185, 0.656219482, 0.628295898, 0.600219727, 0.572036743, 0.543823242, 0.515609741, 0.487472534, 0.459472656, 0.431655884, 0.404083252, 0.376800537, 0.349868774, 0.323318481, 0.297210693, 0.271591187, 0.246505737, 0.221984863, 0.198059082, 0.174789429, 0.152206421, 0.130310059, 0.109161377, 0.088775635, 0.069168091, 0.050354004, 0.032379150, 0.015228271, -0.001068115, -0.016510010, -0.031082153, -0.044784546, -0.057617188, -0.069595337, -0.080688477, -0.090927124, 0.100311279, 0.108856201, 0.116577148, 0.123474121, 0.129577637, 0.134887695, 0.139450073, 0.143264771, 0.146362305, 0.148773193, 0.150497437, 0.151596069, 0.152069092, 0.151962280, 0.151306152, 0.150115967, 0.148422241, 0.146255493, 0.143676758, 0.140670776, 0.137298584, 0.133590698, 0.129562378, 0.125259399, 0.120697021, 0.115921021, 0.110946655, 0.105819702, 0.100540161, 0.095169067, 0.089706421, 0.084182739, 0.078628540, 0.073059082, 0.067520142, 0.061996460, 0.056533813, 0.051132202, 0.045837402, 0.040634155, 0.035552979, 0.030609131, 0.025817871, 0.021179199, 0.016708374, 0.012420654, 0.008316040, 0.004394531, 0.000686646, -0.002822876, -0.006134033, -0.009231567, -0.012115479, -0.014801025, -0.017257690, -0.019531250, -0.021575928, -0.023422241, -0.025085449, -0.026535034, -0.027801514, -0.028884888, -0.029785156, -0.030517578, 0.031082153, 0.031478882, 0.031738281, 0.031845093, 0.031814575, 0.031661987, 0.031387329, 0.031005859, 0.030532837, 0.029937744, 0.029281616, 0.028533936, 0.027725220, 0.026840210, 0.025909424, 0.024932861, 0.023910522, 0.022857666, 0.021789551, 0.020690918, 0.019577026, 0.018463135, 0.017349243, 0.016235352, 0.015121460, 0.014022827, 0.012939453, 0.011886597, 0.010848999, 0.009841919, 0.008865356, 0.007919312, 0.007003784, 0.006118774, 0.005294800, 0.004486084, 0.003723145, 0.003005981, 0.002334595, 0.001693726, 0.001098633, 0.000549316, 0.000030518, -0.000442505, -0.000869751, -0.001266479, -0.001617432, -0.001937866, -0.002227783, -0.002487183, -0.002700806, -0.002883911, -0.003051758, -0.003173828, -0.003280640, -0.003372192, -0.003417969, -0.003463745, -0.003479004, -0.003479004, -0.003463745, -0.003433228, -0.003387451, -0.003326416, 0.003250122, 0.003173828, 0.003082275, 0.002990723, 0.002899170, 0.002792358, 0.002685547, 0.002578735, 0.002456665, 0.002349854, 0.002243042, 0.002120972, 0.002014160, 0.001907349, 0.001785278, 0.001693726, 0.001586914, 0.001480103, 0.001388550, 0.001296997, 0.001205444, 0.001113892, 0.001037598, 0.000961304, 0.000885010, 0.000808716, 0.000747681, 0.000686646, 0.000625610, 0.000579834, 0.000534058, 0.000473022, 0.000442505, 0.000396729, 0.000366211, 0.000320435, 0.000289917, 0.000259399, 0.000244141, 0.000213623, 0.000198364, 0.000167847, 0.000152588, 0.000137329, 0.000122070, 0.000106812, 0.000106812, 0.000091553, 0.000076294, 0.000076294, 0.000061035, 0.000061035, 0.000045776, 0.000045776, 0.000030518, 0.000030518, 0.000030518, 0.000030518, 0.000015259, 0.000015259, 0.000015259, 0.000015259, 0.000015259, 0.000015259], 0, 512);
	var cs = new Float32Array([0.857493, 0.881742, 0.949629, 0.983315, 0.995518, 0.999161, 0.999899, 0.999993]);
	var ca = new Float32Array([-0.514496, -0.471732, -0.313377, -0.181913, -0.094574, -0.040966, -0.014199, -0.003700]);
	var isRatios = [0.000000, 0.267949, 0.577350, 1.000000, 1.732051, 3.732051];
	var SamplesPerGr = 576;
	const MP3Layer3 = function(frameStream, header) {
		this.frameStream = frameStream;
		this.header = header;
		this.prevBits = null;
	}
	MP3Layer3.prototype.read = function() {
		var mp3Data = this.frameStream;
		var nch = this.header.numberOfChannels();
		var framesize = this.frameStream.getLength();
		var sideinfo_size = (this.header.version > 1) ? (nch === 1 ? 9 : 17) : (nch === 1 ? 17 : 32);
		var main_data_size = framesize - sideinfo_size;
		if (this.header.getCRC() === 0) {
			main_data_size -= 2;
			mp3Data.position += 2;
		}
		var sideinfo = this.sideInfo(sideinfo_size, nch);
		var mainData = this.mainData(sideinfo, main_data_size, nch);
		return { sideinfo, mainData: mainData.md, bits: mainData.b };
	}
	MP3Layer3.prototype.sideInfo = function(size, nch) {
		// Sideinfo is MPEG1 Layer 3 Side Info.
		var result = this.frameStream.readBytes(size);
		var s = new BitStream(result);
		var sideinfo = {};
		init2dArray(sideinfo, 'Scfsi', 2, 4);
		init2dArray(sideinfo, 'Part2_3Length', 2, 2);
		init2dArray(sideinfo, 'BigValues', 2, 2);
		init2dArray(sideinfo, 'GlobalGain', 2, 2);
		init2dArray(sideinfo, 'ScalefacCompress', 2, 2);
		init2dArray(sideinfo, 'WinSwitchFlag', 2, 2);
		init2dArray(sideinfo, 'BlockType', 2, 2);
		init2dArray(sideinfo, 'MixedBlockFlag', 2, 2);
		init3dArray(sideinfo, 'TableSelect', 2, 2, 3);
		init3dArray(sideinfo, 'SubblockGain', 2, 2, 3);
		init2dArray(sideinfo, 'Region0Count', 2, 2);
		init2dArray(sideinfo, 'Region1Count', 2, 2);
		init2dArray(sideinfo, 'Preflag', 2, 2);
		init2dArray(sideinfo, 'ScalefacScale', 2, 2);
		init2dArray(sideinfo, 'Count1TableSelect', 2, 2);
		init2dArray(sideinfo, 'Count1', 2, 2);
		sideinfo.MainDataBegin = s.Bits((this.header.version > 1) ? 8 : 9);
		sideinfo.PrivateBits = s.Bits(((nch === 1) ? 5 : 3));
		var ngr = 1;
		if (!(this.header.version > 1)) {
			ngr = 2;
			for (var ch = 0; ch < nch; ch++) {
				for (var scfsi_band = 0; scfsi_band < 4; scfsi_band++) {
					sideinfo.Scfsi[ch][scfsi_band] = s.Bits(1);
				}
			}
		}
		for (var gr = 0; gr < ngr; gr++) {
			for (var ch = 0; ch < nch; ch++) {
				sideinfo.Part2_3Length[gr][ch] = s.Bits(12);
				sideinfo.BigValues[gr][ch] = s.Bits(9);
				sideinfo.GlobalGain[gr][ch] = s.Bits(8);
				sideinfo.ScalefacCompress[gr][ch] = s.Bits((this.header.version > 1) ? 9 : 4);

				if (sideinfo.BigValues[gr][ch] > 288) throw new Error('bad big_values count');

				sideinfo.WinSwitchFlag[gr][ch] = s.Bits(1);
				if (sideinfo.WinSwitchFlag[gr][ch] === 1) {
					sideinfo.BlockType[gr][ch] = s.Bits(2);
					sideinfo.MixedBlockFlag[gr][ch] = s.Bits(1);
					for (var region = 0; region < 2; region++) {
						sideinfo.TableSelect[gr][ch][region] = s.Bits(5);
					}
					for (var i = 0; i < 3; i++) {
						sideinfo.SubblockGain[gr][ch][i] = s.Bits(3);
					}
					if (sideinfo.BlockType[gr][ch] === 2 && sideinfo.MixedBlockFlag[gr][ch] === 0) {
						sideinfo.Region0Count[gr][ch] = 8;
					} else {
						sideinfo.Region0Count[gr][ch] = 7;
					}
					sideinfo.Region1Count[gr][ch] = 20 - sideinfo.Region0Count[gr][ch];
				} else {
					for (var region = 0; region < 3; region++) {
						sideinfo.TableSelect[gr][ch][region] = s.Bits(5);
					}
					sideinfo.Region0Count[gr][ch] = s.Bits(4);
					sideinfo.Region1Count[gr][ch] = s.Bits(3);
					sideinfo.BlockType[gr][ch] = 0; // Implicit
				}
				sideinfo.Preflag[gr][ch] = s.Bits(1);
				sideinfo.ScalefacScale[gr][ch] = s.Bits(1);
				sideinfo.Count1TableSelect[gr][ch] = s.Bits(1);
			}
		}
		return sideinfo;
	}
	MP3Layer3.prototype.mainData = function(sideinfo, main_data_size, nch) {
		// Maindata is MPEG1 Layer 3 Main Data.
		var result2 = this.getMD(this.frameStream, this.prevBits, main_data_size, sideinfo.MainDataBegin);
		if (result2.err) {
			console.log(result2.err);
			return null;
		}
		var b = result2.b;
		var md = {};
		init3dArray(md, 'ScalefacL', 2, 2, 22);
		init4dArray(md, 'ScalefacS', 2, 2, 13, 3);
		init3dArray(md, 'Is', 2, 2, SamplesPerGr);
		for (var gr = 0; gr < 2; gr++) {
			for (var ch = 0; ch < nch; ch++) {
				var part_2_start = b.BitPos();
				// Number of bits in the bitstream for the bands
				var slen1 = scalefacSizes[sideinfo.ScalefacCompress[gr][ch]][0];
				var slen2 = scalefacSizes[sideinfo.ScalefacCompress[gr][ch]][1];
				if (sideinfo.WinSwitchFlag[gr][ch] === 1 && sideinfo.BlockType[gr][ch] === 2) {
					if (sideinfo.MixedBlockFlag[gr][ch] !== 0) {
						for (var sfb = 0; sfb < 8; sfb++) {
							md.ScalefacL[gr][ch][sfb] = b.Bits(slen1);
						}
						for (var sfb = 3; sfb < 12; sfb++) {
							//slen1 for band 3-5,slen2 for 6-11
							var nbits = slen2;
							if (sfb < 6) nbits = slen1;
							for (var win = 0; win < 3; win++) {
								md.ScalefacS[gr][ch][sfb][win] = b.Bits(nbits);
							}
						}
					} else {
						for (var sfb = 0; sfb < 12; sfb++) {
							var nbits = slen2;
							if (sfb < 6) nbits = slen1;
							for (var win = 0; win < 3; win++) {
								md.ScalefacS[gr][ch][sfb][win] = b.Bits(nbits);
							}
						}
					}
				} else {
					if (sideinfo.Scfsi[ch][0] === 0 || gr === 0) {
						for (var sfb = 0; sfb < 6; sfb++) {
							md.ScalefacL[gr][ch][sfb] = b.Bits(slen1);
						}
					} else if (sideinfo.Scfsi[ch][0] === 1 && gr === 1) {
						for (var sfb = 0; sfb < 6; sfb++) {
							md.ScalefacL[1][ch][sfb] = md.ScalefacL[0][ch][sfb];
						}
					}
					if (sideinfo.Scfsi[ch][1] === 0 || gr === 0) {
						for (var sfb = 6; sfb < 11; sfb++) {
							md.ScalefacL[gr][ch][sfb] = b.Bits(slen1);
						}
					} else if (sideinfo.Scfsi[ch][1] === 1 && gr === 1) {
						for (var sfb = 6; sfb < 11; sfb++) {
							md.ScalefacL[1][ch][sfb] = md.ScalefacL[0][ch][sfb];
						}
					}
					if (sideinfo.Scfsi[ch][2] === 0 || gr === 0) {
						for (var sfb = 11; sfb < 16; sfb++) {
							md.ScalefacL[gr][ch][sfb] = b.Bits(slen2);
						}
					} else if (sideinfo.Scfsi[ch][2] === 1 && gr === 1) {
						for (var sfb = 11; sfb < 16; sfb++) {
							md.ScalefacL[1][ch][sfb] = md.ScalefacL[0][ch][sfb];
						}
					}
					if (sideinfo.Scfsi[ch][3] === 0 || gr === 0) {
						for (var sfb = 16; sfb < 21; sfb++) {
							md.ScalefacL[gr][ch][sfb] = b.Bits(slen2);
						}
					} else if (sideinfo.Scfsi[ch][3] === 1 && gr === 1) {
						for (var sfb = 16; sfb < 21; sfb++) {
							md.ScalefacL[1][ch][sfb] = md.ScalefacL[0][ch][sfb];
						}
					}
				}
				var err = this.getHuffman(b, this.header, sideinfo, md, part_2_start, gr, ch);
				if (err) {
					console.log(err);
					return null;
				}
			}
		}
		return { md, b };
	}
	MP3Layer3.prototype.getMD = function(source, prev, size, offset) {
		if (size > 1500) {
			console.log("mp3: size = " + size);
			return null;
		}
		if (prev !== null && offset > prev.LenInBytes()) {
			var buf = new Uint8Array(source.data, 0, size);
			if (buf.length < size) {
				console.log("maindata.Read (1)");
				return null;
			}
			return {
				m: prev.append(buf),
				err: null
			};
		}
		var vec;
		if (prev !== null) {
			vec = prev.Tail(offset);
		}
		var buf = source.readBytes(size);
		if (buf.byteLength < size) {
			console.log("maindata.Read (2)");
			return null;
		}
		return {
			b: new BitStream(concatBuffers(vec, new Uint8Array(buf.slice()).buffer)),
			err: null
		};
	}
	MP3Layer3.prototype.getHuffman = function(m, header, sideInfo, mainData, part_2_start, gr, ch) {
		if (sideInfo.Part2_3Length[gr][ch] === 0) {
			for (var i = 0; i < SamplesPerGr; i++) {
				mainData.Is[gr][ch][i] = 0.0;
			}
			return null;
		}
		var bit_pos_end = part_2_start + sideInfo.Part2_3Length[gr][ch] - 1;
		var region_1_start = 0;
		var region_2_start = 0;
		if ((sideInfo.WinSwitchFlag[gr][ch] === 1) && (sideInfo.BlockType[gr][ch] === 2)) {
			region_1_start = 36;
			region_2_start = SamplesPerGr;
		} else {
			var sfreq = header.rate;
			var l = SfBandIndicesSet[sfreq].L;
			var i = sideInfo.Region0Count[gr][ch] + 1;
			if (i < 0 || util_len(l) <= i) {
				return "mp3: readHuffman failed: invalid index i: " + i;
			}
			region_1_start = l[i];
			var j = sideInfo.Region0Count[gr][ch] + sideInfo.Region1Count[gr][ch] + 2;
			if (j < 0 || util_len(l) <= j) {
				return "mp3: readHuffman failed: invalid index j: " + j;
			}
			region_2_start = l[j];
		}
		for (var is_pos = 0; is_pos < sideInfo.BigValues[gr][ch] * 2; is_pos++) {
			if (is_pos >= util_len(mainData.Is[gr][ch])) {
				return "mp3: is_pos was too big: " + is_pos;
			}
			var table_num = 0;
			if (is_pos < region_1_start) {
				table_num = sideInfo.TableSelect[gr][ch][0];
			} else if (is_pos < region_2_start) {
				table_num = sideInfo.TableSelect[gr][ch][1];
			} else {
				table_num = sideInfo.TableSelect[gr][ch][2];
			}
			var result = huffman_decode(m, table_num);
			if (result.err) {
				return err;
			}
			mainData.Is[gr][ch][is_pos] = result.x;
			is_pos++;
			mainData.Is[gr][ch][is_pos] = result.y;
		}
		var table_num = sideInfo.Count1TableSelect[gr][ch] + 32;
		var is_pos = sideInfo.BigValues[gr][ch] * 2;
		for (; is_pos <= 572 && m.BitPos() <= bit_pos_end;) {
			var result = huffman_decode(m, table_num);
			if (result.err) {
				return err;
			}
			mainData.Is[gr][ch][is_pos] = result.v;
			is_pos++;
			if (is_pos >= SamplesPerGr) {
				break;
			}
			mainData.Is[gr][ch][is_pos] = result.w;
			is_pos++;
			if (is_pos >= SamplesPerGr) {
				break;
			}
			mainData.Is[gr][ch][is_pos] = result.x;
			is_pos++;
			if (is_pos >= SamplesPerGr) {
				break;
			}
			mainData.Is[gr][ch][is_pos] = result.y;
			is_pos++;
		}
		if (m.BitPos() > (bit_pos_end + 1)) {
			is_pos -= 4;
		}
		sideInfo.Count1[gr][ch] = is_pos;
		for (; is_pos < SamplesPerGr;) {
			mainData.Is[gr][ch][is_pos] = 0.0;
			is_pos++;
		}
		m.SetPos(bit_pos_end + 1);
		return null;
	}
	
	var BytesPerFrame = SamplesPerGr * 2 * 4;
	
	const MP3Frame = function(header, sideInfo, mainData) {
		this.header = header;
		this.sideInfo = sideInfo;
		this.mainData = mainData;
		this.store = new Array(2);
		for (var i = 0; i < this.store.length; i++) {
			var a = new Array(32);
			for (var j = 0; j < a.length; j++) {
				a[j] = new Float32Array(18);
			}
			this.store[i] = a;
		}
		this.v_vec = new Array(2);
		for (var i = 0; i < this.v_vec.length; i++) {
			this.v_vec[i] = new Float32Array(1024);
		}
	}
	MP3Frame.prototype.decode = function() {
		var nch = this.header.numberOfChannels();
		var out;
		if (nch === 1) {
			out = new Uint8Array(BytesPerFrame / 2);
		} else {
			out = new Uint8Array(BytesPerFrame);
		}
		for (var gr = 0; gr < 2; gr++) {
			for (var ch = 0; ch < nch; ch++) {
				this.requantize(gr, ch);
				this.reorder(gr, ch);
			}
			this.stereo(gr);
			for (var ch = 0; ch < nch; ch++) {
				this.antialias(gr, ch);
				this.hybridSynthesis(gr, ch);
				this.frequencyInversion(gr, ch);
				if (nch === 1) {
					this.subbandSynthesis(gr, ch, out.subarray(SamplesPerGr * 4 * gr / 2));
				} else {
					this.subbandSynthesis(gr, ch, out.subarray(SamplesPerGr * 4 * gr));
				}
			}
		}
		return out;
	}
	MP3Frame.prototype.antialias = function(gr, ch) {
		var winSwitchFlag = this.sideInfo.WinSwitchFlag[gr][ch];
		var blockType = this.sideInfo.BlockType[gr][ch];
		var mixedBlockFlag = this.sideInfo.MixedBlockFlag[gr][ch];
		var isa = this.mainData.Is[gr][ch];
		if ((winSwitchFlag === 1) && (blockType === 2) && mixedBlockFlag === 0) return;
		var sblim = 32;
		if ((winSwitchFlag === 1) && (blockType === 2) && (mixedBlockFlag === 1)) sblim = 2;
		for (var sb = 1; sb < sblim; sb++) {
			for (var i = 0; i < 8; i++) {
				var li = 18 * sb - 1 - i;
				var ui = 18 * sb + i;
				var lb = isa[li] * cs[i] - isa[ui] * ca[i];
				var ub = isa[ui] * cs[i] + isa[li] * ca[i];
				isa[li] = lb;
				isa[ui] = ub;
			}
		}
	}
	MP3Frame.prototype.hybridSynthesis = function(gr, ch) {
		var winSwitchFlag = this.sideInfo.WinSwitchFlag[gr][ch];
		var blockType = this.sideInfo.BlockType[gr][ch];
		var mixedBlockFlag = this.sideInfo.MixedBlockFlag[gr][ch];
		var isa = this.mainData.Is[gr][ch];
		for (var sb = 0; sb < 32; sb++) {
			var bt = blockType;
			if ((winSwitchFlag === 1) && (mixedBlockFlag === 1) && (sb < 2)) bt = 0;
			var inData = new Float32Array(18);
			for (var i = 0; i < 18; i++) inData[i] = isa[sb * 18 + i];
			var rawout = Imdct.Win(inData, bt);
			for (var i = 0; i < 18; i++) {
				isa[sb * 18 + i] = rawout[i] + this.store[ch][sb][i];
				this.store[ch][sb][i] = rawout[i + 18];
			}
		}
	}
	MP3Frame.prototype.frequencyInversion = function(gr, ch) {
		var isa = this.mainData.Is[gr][ch];
		for (var sb = 1; sb < 32; sb += 2) {
			for (var i = 1; i < 18; i += 2) {
				isa[sb * 18 + i] = -isa[sb * 18 + i];
			}
		}
	}
	MP3Frame.prototype.stereo = function(gr) {
		var isar = this.mainData.Is[gr];
		if (this.header.useMSStereo()) {
			var i = 1;
			if (this.sideInfo.Count1[gr][0] > this.sideInfo.Count1[gr][1]) {
				i = 0;
			}
			var max_pos = this.sideInfo.Count1[gr][i];
			const invSqrt2 = Math.SQRT2 / 2;
			for (var i = 0; i < max_pos; i++) {
				var left = (isar[0][i] + isar[1][i]) * invSqrt2;
				var right = (isar[0][i] - isar[1][i]) * invSqrt2;
				isar[0][i] = left;
				isar[1][i] = right;
			}
		}
		if (this.header.useIntensityStereo()) {
			var sfreq = this.header.rate;
			if ((this.sideInfo.WinSwitchFlag[gr][0] === 1) && (this.sideInfo.BlockType[gr][0] === 2)) {
				if (this.sideInfo.MixedBlockFlag[gr][0] !== 0) {
					for (var sfb = 0; sfb < 8; sfb++) {
						if (SfBandIndicesSet[sfreq].L[sfb] >= this.sideInfo.Count1[gr][1]) this.stereoProcessIntensityLong(gr, sfb);
					}
					for (var sfb = 3; sfb < 12; sfb++) {
						if (SfBandIndicesSet[sfreq].S[sfb] * 3 >= this.sideInfo.Count1[gr][1]) this.stereoProcessIntensityShort(gr, sfb);
					}
				} else {
					for (var sfb = 0; sfb < 12; sfb++) {
						if (SfBandIndicesSet[sfreq].S[sfb] * 3 >= this.sideInfo.Count1[gr][1]) this.stereoProcessIntensityShort(gr, sfb);
					}
				}
			} else {
				for (var sfb = 0; sfb < 21; sfb++) {
					if (SfBandIndicesSet[sfreq].L[sfb] >= this.sideInfo.Count1[gr][1]) this.stereoProcessIntensityLong(gr, sfb);
				}
			}
		}
	}
	MP3Frame.prototype.stereoProcessIntensityLong = function(gr, sfb) {
		var isar = this.mainData.Is[gr];
		var is_ratio_l = 0.0;
		var is_ratio_r = 0.0;
		var is_pos = this.mainData.ScalefacL[gr][0][sfb];
		if (is_pos < 7) {
			var sfreq = this.header.rate;
			var sfb_start = SfBandIndicesSet[sfreq].L[sfb];
			var sfb_stop = SfBandIndicesSet[sfreq].L[sfb + 1];
			if (is_pos === 6) {
				is_ratio_l = 1.0;
				is_ratio_r = 0.0;
			} else {
				is_ratio_l = isRatios[is_pos] / (1.0 + isRatios[is_pos]);
				is_ratio_r = 1.0 / (1.0 + isRatios[is_pos]);
			}
			for (var i = sfb_start; i < sfb_stop; i++) {
				isar[0][i] *= is_ratio_l;
				isar[1][i] *= is_ratio_r;
			}
		}
	}
	MP3Frame.prototype.stereoProcessIntensityShort = function(gr, sfb) {
		var isar = this.mainData.Is[gr];
		var is_ratio_l = 0.0;
		var is_ratio_r = 0.0;
		var sfreq = this.header.rate;
		var win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
		for (var win = 0; win < 3; win++) {
			var is_pos = this.mainData.ScalefacS[gr][0][sfb][win];
			if (is_pos < 7) {
				var sfb_start = SfBandIndicesSet[sfreq].S[sfb] * 3 + win_len * win;
				var sfb_stop = sfb_start + win_len;
				if (is_pos === 6) {
					is_ratio_l = 1.0;
					is_ratio_r = 0.0;
				} else {
					is_ratio_l = isRatios[is_pos] / (1.0 + isRatios[is_pos]);
					is_ratio_r = 1.0 / (1.0 + isRatios[is_pos]);
				}
				for (var i = sfb_start; i < sfb_stop; i++) {
					isar[0][i] *= is_ratio_l;
					isar[1][i] *= is_ratio_r;
				}
			}
		}
	}
	MP3Frame.prototype.requantize = function(gr, ch) {
		var winSwitchFlag = this.sideInfo.WinSwitchFlag[gr][ch];
		var blockType = this.sideInfo.BlockType[gr][ch];
		var mixedBlockFlag = this.sideInfo.MixedBlockFlag[gr][ch];
		var sfreq = this.header.rate;
		if (winSwitchFlag === 1 && blockType === 2) {
			if (mixedBlockFlag !== 0) {
				var sfb = 0;
				var next_sfb = SfBandIndicesSet[sfreq].L[sfb + 1];
				for (var i = 0; i < 36; i++) {
					if (i === next_sfb) {
						sfb++;
						next_sfb = SfBandIndicesSet[sfreq].L[sfb + 1];
					}
					this.requantizeProcessLong(gr, ch, i, sfb);
				}
				sfb = 3;
				next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
				var win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
				for (var i = 36; i < (f.sideInfo.Count1[gr][ch] | 0);) {
					if (i === next_sfb) {
						sfb++;
						next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
						win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
					}
					for (var win = 0; win < 3; win++) {
						for (var j = 0; j < win_len; j++) {
							this.requantizeProcessShort(gr, ch, i, sfb, win);
							i++;
						}
					}
				}
			} else {
				var sfb = 0;
				var next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
				var win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
				for (var i = 0; i < this.sideInfo.Count1[gr][ch];) {
					if (i === next_sfb) {
						sfb++;
						next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
						win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
					}
					for (var win = 0; win < 3; win++) {
						for (var j = 0; j < win_len; j++) {
							this.requantizeProcessShort(gr, ch, i, sfb, win);
							i++;
						}
					}
				}
			}
		} else {
			var sfb = 0;
			var next_sfb = SfBandIndicesSet[sfreq].L[sfb + 1];
			for (var i = 0; i < this.sideInfo.Count1[gr][ch]; i++) {
				if (i === next_sfb) {
					sfb++;
					next_sfb = SfBandIndicesSet[sfreq].L[sfb + 1];
				}
				this.requantizeProcessLong(gr, ch, i, sfb);
			}
		}
	}
	MP3Frame.prototype.requantizeProcessLong = function(gr, ch, is_pos, sfb) {
		var isar = this.mainData.Is[gr][ch];
		var sf_mult = 0.5;
		if (this.sideInfo.ScalefacScale[gr][ch] !== 0) {
			sf_mult = 1.0;
		}
		var pf_x_pt = this.sideInfo.Preflag[gr][ch] * pretab[sfb];
		var idx = -(sf_mult * (this.mainData.ScalefacL[gr][ch][sfb] + pf_x_pt)) + 0.25 * (this.sideInfo.GlobalGain[gr][ch] - 210);
		var tmp1 = Math.pow(2.0, idx);
		var tmp2 = 0.0;
		if (this.mainData.Is[gr][ch][is_pos] < 0.0) {
			tmp2 = -powtab34[-isar[is_pos]];
		} else {
			tmp2 = powtab34[isar[is_pos]];
		}
		isar[is_pos] = tmp1 * tmp2;
	}
	MP3Frame.prototype.requantizeProcessShort = function(gr, ch, is_pos, sfb, win) {
		var isar = this.mainData.Is[gr][ch];
		var sf_mult = 0.5;
		if (this.sideInfo.ScalefacScale[gr][ch] !== 0) sf_mult = 1.0;
		var idx = -(sf_mult * this.mainData.ScalefacS[gr][ch][sfb][win]) + 0.25 * (this.sideInfo.GlobalGain[gr][ch] - 210.0 - 8.0 * this.sideInfo.SubblockGain[gr][ch][win]);
		var tmp1 = Math.pow(2.0, idx);
		var tmp2 = 0.0;
		if (isar[is_pos] < 0) {
			tmp2 = -powtab34[-isar[is_pos]];
		} else {
			tmp2 = powtab34[isar[is_pos]];
		}
		this.mainData.Is[gr][ch][is_pos] = tmp1 * tmp2;
	}
	MP3Frame.prototype.reorder = function(gr, ch) {
		var isar = this.mainData.Is[gr][ch];
		var winSwitchFlag = this.sideInfo.WinSwitchFlag[gr][ch];
		var blockType = this.sideInfo.BlockType[gr][ch];
		var mixedBlockFlag = this.sideInfo.MixedBlockFlag[gr][ch];
		var re = new Float32Array(SamplesPerGr);
		var sfreq = this.header.rate;
		if ((winSwitchFlag === 1) && (blockType == 2)) {
			var sfb = 0;
			if (mixedBlockFlag !== 0) {
				sfb = 3;
			}
			var next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
			var win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
			var i = 36;
			if (sfb === 0) {
				i = 0;
			}
			for (; i < SamplesPerGr;) {
				if (i === next_sfb) {
					var j = 3 * SfBandIndicesSet[sfreq].S[sfb];
					for (var s = 0; s < 3 * win_len; s++) {
						isar[j + s] = re[s];
					}
					if (i >= this.sideInfo.Count1[gr][ch]) {
						return;
					}
					sfb++;
					next_sfb = SfBandIndicesSet[sfreq].S[sfb + 1] * 3;
					win_len = SfBandIndicesSet[sfreq].S[sfb + 1] - SfBandIndicesSet[sfreq].S[sfb];
				}
				for (var win = 0; win < 3; win++) {
					for (j = 0; j < win_len; j++) {
						re[j * 3 + win] = isar[i];
						i++;
					}
				}
			}
			var j = 3 * SfBandIndicesSet[sfreq].S[12];
			for (var s = 0; s < 3 * win_len; s++) {
				this.mainData.Is[gr][ch][j + s] = re[s];
			}
		}
	}
	MP3Frame.prototype.subbandSynthesis = function(gr, ch, out) {
		var u_vec = new Float32Array(512);
		var s_vec = new Float32Array(32);
		var nch = this.header.numberOfChannels();
		for (var ss = 0; ss < 18; ss++) {
			this.v_vec[ch].set(this.v_vec[ch].slice(0, 1024 - 64), 64);
			var d = this.mainData.Is[gr][ch];
			for (var i = 0; i < 32; i++) s_vec[i] = d[i * 18 + ss];
			for (var i = 0; i < 64; i++) {
				var sum = 0;
				for (var j = 0; j < 32; j++) sum += synthNWin[i][j] * s_vec[j];
				this.v_vec[ch][i] = sum;
			}
			var v = this.v_vec[ch];
			for (var i = 0; i < 512; i += 64) {
				u_vec.set(v.slice((i << 1) >>> 0, ((i << 1) >>> 0) + 32), i);
				u_vec.set(v.slice(((i << 1) >>> 0) + 96, ((i << 1) >>> 0) + 128), i + 32);
			}
			for (var i = 0; i < 512; i++) u_vec[i] *= synthDtbl[i];
			for (var i = 0; i < 32; i++) {
				var sum = 0;
				for (var j = 0; j < 512; j += 32) sum += u_vec[j + i];
				var samp = sum * 32767;
				if (samp > 32767) samp = 32767;
				if (samp < -32767) samp = -32767;
				var s = samp;
				var idx;
				if (nch === 1) {
					idx = 2 * (32 * ss + i);
				} else {
					idx = 4 * (32 * ss + i);
				}
				if (ch === 0) {
					out[idx] = s;
					out[idx + 1] = (s >>> 8) >>> 0;
				} else {
					out[idx + 2] = s;
					out[idx + 3] = (s >>> 8) >>> 0;
				}
			}
		}
		return out;
	}
	const MP3StreamDecoder = function(data) {
		this.stream = data;
		this._frame = null;
		this._prevMainDataBits = null;
		this.header = 0;
		this.firstHeader = 0;
		this.sampleIndex = 0;
		this.sampleCount = 0;
		this.frameCount = 0;
		this.version = 0;
		this.channels = 0;
		this.tags = null;
		this.startFrame = [];
		this.type = 'MP3';
		this.isLoad = false;
	}
	MP3StreamDecoder.prototype.readTags = function() {
		// Skip zero or more id3v1 and/or id3v2 tags. (Some mp3 files begin with multiple tags.)
		var tags = [];
		while (this.stream.getBytesAvailable() > 10) {
			var startPos = this.stream.position;
			var tag = this.stream.readString(3);
			if (tag == 'ID3') {
				this.stream.position += 3;
				var b3 = this.stream.readByte() | 0;
				var b2 = this.stream.readByte() | 0;
				var b1 = this.stream.readByte() | 0;
				var b0 = this.stream.readByte() | 0;
				var len = ((b3 << 21) + (b2 << 14) + (b1 << 7) + b0) | 0;
				tags.push(["id3", this.stream.readString(len)]);
			} else if (tag == 'TAG') {
				tags.push(["tag"]);
				this.stream.position += 125; // TAG is 128 bytes total
			} else {
				this.stream.position = startPos;
				return tags;
			}
		}
	}
	MP3StreamDecoder.prototype.readFrameHeader = function() {
		var mp3FrameHeader = new MP3FrameHeader();
		while (this.stream.getBytesAvailable() > 4) {
			var b = this.stream.readByte() & 0xFF;
			if (b == 0xFF) {
				this.stream.position -= 1;
				var frameStart = this.stream.position;
				var header = this.stream.readInt();
				if (mp3FrameHeader.isValidHeader(header)) {
					mp3FrameHeader.parseHeader(header);
					return mp3FrameHeader;
				}
				this.stream.position = frameStart + 1;
			}
		}
		return null;
	}
	MP3StreamDecoder.prototype.appendFrame = function() {
		var header = this.readFrameHeader();
		this.header = header;
		if (header.version !== 1) {
			throw new Error("mp3: only MPEG version 1 (want " + 1 + "; got " + header.version + ") is supported");
		}
		if (header.layer !== 3) {
			throw new Error("mp3: only layer3 (want " + 3 + "; got " + header.layer + ") is supported");
		}
		var frameSize = header.frameSize() - 4;
		var frameStream = this.stream.extract(frameSize);
		this.stream.position += frameSize;
		var layer3 = new MP3Layer3(frameStream, header);
		layer3.prevBits = this._prevMainDataBits;
		var e = layer3.read();
		this._prevMainDataBits = e.bits;
		var loaderFrame = new MP3Frame(header, e.sideinfo, e.mainData);
		if (this._frame) {
			loaderFrame.store = this._frame.store;
			loaderFrame.v_vec = this._frame.v_vec;
		}
		this._frame = loaderFrame;
		var pcm_buf = loaderFrame.decode();
		var pcm = new ArrayBufferStream(pcm_buf.buffer);
		pcm.littleEndian = true;
		for (var i = 0; i < (pcm.getLength() / 2); i++) {
			this.writeSample(i % this.channels, this.sampleIndex + Math.floor(i / this.channels), (pcm.readShort() / 32768));
		}
	}
	MP3StreamDecoder.prototype.start = function() {
		this.tags = this.readTags();
		var pos = this.stream.position;
		this.firstHeader = this.readFrameHeader();
		this.rate = this.firstHeader.samplingFrequency();
		this.channels = this.firstHeader.numberOfChannels();
		this.type = 'VERSION ' + this.firstHeader.version + ' LAYER ' + this.firstHeader.layer;
		this.version = this.firstHeader.version;
		this.stream.position = pos;
		var frameStarts = [];
		var frameCount = 0;
		while (this.stream.getBytesAvailable() > 4) {
			var result = this.readFrameHeader();
			if (result == null) {
				break;
			}
			frameStarts.push(this.stream.position);
			var eeee = (result.frameSize() - 4);
			if (!((this.stream.getBytesAvailable() - eeee) > 4)) {
				break;
			}
			frameCount += 1;
			this.stream.position += eeee;
		}
		this.startFrame = frameStarts;
		this.frameCount = frameCount;
		this.sampleCount = (frameCount * ((this.version == 1) ? 1152 : 576));
		this.stream.position = pos;
	}
	MP3StreamDecoder.prototype.getByteLength = function() {
		return this.stream.getLength();
	}
	MP3StreamDecoder.prototype.nextSample = function() {
		this.sampleIndex += ((this.version == 1) ? 1152 : 576);
	}
	MP3StreamDecoder.prototype.getLoadedTime = function() {
		return (this.sampleIndex / this.sampleCount) * (this.sampleCount / this.rate);
	}
	MP3StreamDecoder.prototype.setChannels = function(buffer) {
		this.channelLeft = buffer.getChannelData(0);
		if (this.channels == 2) {
			this.channelRight = buffer.getChannelData(1);
		}
	}
	MP3StreamDecoder.prototype.writeSample = function(channel, id, sample) {
		var ch = (channel == 1) ? this.channelRight : this.channelLeft;
		ch[id] = sample;
	}
	MP3StreamDecoder.prototype.step = function() {
		if (this.isLoad) return;
		var d = Date.now();
		while (true) {
			this.appendFrame();
			this.nextSample();
			if ((!(this.stream.getBytesAvailable() > 4)) || (this.sampleIndex >= this.sampleCount)) {
				this.isLoad = true;
				return;
			}
			if ((Date.now() - d) > 10) return;
		}
	}
	const Player = function() {
		this.isPaused = true;
		this.rate = 44100;
		this.channels = 1;
		this.isEstreno = false;
		this.audioContext = new AudioContext();
		this.node = this.audioContext.createGain();
		this.node.connect(this.audioContext.destination);
		this.startTime = Date.now();
		this.duration = 0;
		this.sampleCount = 0;
		this.currentTime = 0;
		this.buffer = null;
		this.onended = null;
		this.stream = null;
		this.playingSource = null;
		this.isLoad = false;
		this.loadingLoaded = 0;
		this._p = 0;
		setInterval(this.step.bind(this), 5);
	}
	Player.prototype.cleanup = function() {
		this.stream = null;
		this.stopSource();
		this.sampleCount = 0;
		this.currentTime = 0;
		this.setStartTime(this.currentTime);
		this.duration = 0;
		this.rate = 41000;
		this.isPaused = true;
		this.isLoad = false;
	}
	Player.prototype.setCurrentTime = function(time) {
		this.currentTime = time;
		this.setStartTime(time);
		if (!this.isPaused) {
			this.playSource(this.currentTime);
		}
	}
	Player.prototype.setVolume = function(v) {
		this.node.gain.value = v;
	}
	Player.prototype.getVolume = function() {
		return this.node.gain.value;
	}
	Player.prototype.setStartTime = function(time) {
		this.startTime = (Date.now() - (time * 1000));
	}
	Player.prototype.getTime = function() {
		return (Date.now() - this.startTime) / 1000;
	}
	Player.prototype.play = function() {
		if (!this.isLoad) return;
		this.isPaused = false;
		this.setStartTime(this.currentTime);
		if (this.currentTime >= this.duration) {
			this.currentTime = 0;
			this.setStartTime(0);
		}
		this.playSource(this.currentTime);
	}
	Player.prototype.getType = function() {
		if (!this.stream) return '';
		return this.stream.type;
	}
	Player.prototype.getByteLength = function() {
		if (!this.stream) return 0;
		return this.stream.getByteLength();
	}
	Player.prototype.getLoadedTime = function() {
		if (!this.stream) return 0;
		return this.stream.getLoadedTime();
	}
	Player.prototype.isLoadStream = function() {
		if (!this.stream) return false;
		return this.stream.isLoad;
	}
	Player.prototype.stop = function() {
		this.isPaused = true;
		this.currentTime = 0;
		this.setStartTime(0);
		this.stopSource();
	}
	Player.prototype.pause = function() {
		if (!this.isLoad) return;
		this.isPaused = true;
		this.setStartTime(this.currentTime);
		this.stopSource();
	}
	Player.prototype.playSource = function(time) {
		this._p = Date.now();
		this.stopSource();
		this.playingSource = this.audioContext.createBufferSource();
		this.playingSource.buffer = this.buffer;
		this.playingSource.connect(this.node);
		this.playingSource.start(this.audioContext.currentTime, time);
	}
	Player.prototype.stopSource = function() {
		if (this.playingSource) {
			this.playingSource.disconnect();
			this.playingSource = null;
		}
	}
	Player.prototype.step = function() {
		var MaxLoadedTime = Math.max((this.duration / 6), 30);
		var MaxProgressTime = MaxLoadedTime / 12;
		if (this.stream) {
			if ((this.getLoadedTime() - (Math.floor(this.currentTime / MaxProgressTime) * MaxProgressTime)) < MaxLoadedTime) this.stream.step();
		}
		if (this.loadingLoaded == 0 && !this.isLoadStream()) {
			if (this.currentTime > this.getLoadedTime()) {
				this.loadingLoaded = 1;
			}
		}
		if (this.loadingLoaded == 1) {
			var r = this.getLoadedTime();
			this.currentTime = r;
			this.setStartTime(r);
			if (!this.isPaused) {
				this.playSource(r);
			}
			this.loadingLoaded = 0;
		}
		if (this.currentTime > this.duration && !this.isPaused) {
			this.stopSource();
			this.currentTime = this.duration;
			this.setStartTime(this.duration);
			this.isPaused = true;
			if (this.onended) this.onended();
		}
		if (!this.isPaused && this.loadingLoaded == 0) {
			this.currentTime = Math.round((Date.now() - this.startTime)) / 1000;
		}
	}
	Player.prototype.loadAudio = function(data) {
		var _this = this;
		_this.cleanup();
		var byteStream = new ArrayBufferStream(data);
		var type = byteStream.readString(4);
		byteStream.position = 0;
		var parser = null;
		if (type == 'RIFF') {
			parser = new WAVStreamDecoder(byteStream);
		} else {
			parser = new MP3StreamDecoder(byteStream);
		}
		try {
			parser.start();
			this.rate = parser.rate;
			this.channels = parser.channels;
			this.duration = (parser.sampleCount / parser.rate);
			this.sampleCount = parser.sampleCount;
			if (parser.channels == 2) {
				this.isEstreno = true;
			} else {
				this.isEstreno = false;
			}
			this.buffer = this.audioContext.createBuffer(parser.channels, this.sampleCount, this.rate);
			parser.setChannels(this.buffer);
			parser.step();
			this.stream = parser;
			this.isLoad = true;
		} catch (e) {
			console.log("Reject! " + e.message);
		}
	}
	return {
		Player,
		ArrayBufferStream
	}
}());