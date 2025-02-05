/*
 * Anim Tred Sound Decoder Engine
 *
 * v1.2 (5-02-2025)
 *
 * (c) 2025 SEATGERY
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
	//////// wav.js ////////
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
			this.samplesPerBlock = samplesPerBlock;
			var factChunk = this.extractChunk('fact', stream);
			if ((factChunk != null) && (factChunk.getLength() == 4)) {
				this.sampleLength = factChunk.readInt() * this.channels;
			} else {
				var _ = (this.channels == 2) ? 8 : 4;
				var a = this.channels - 1;
				const adpcmBlockSize = (this.channels == 2) ? ((samplesPerBlock - 1) + 8) : ((samplesPerBlock - 1) / 2) + 4;
				const available = this.compressedData.getBytesAvailable();
				const blocks = (available / adpcmBlockSize) | 0;
				const fullBlocks = blocks * (2 * (adpcmBlockSize - _)) + 1;
				const subBlock = Math.max((available % adpcmBlockSize) - _, 0) * 2;
				const incompleteBlock = Math.min(available % adpcmBlockSize, 1);
				this.sampleLength = (fullBlocks + subBlock + incompleteBlock) >> a << a >>> 0;
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
		var compressedData = this.compressedData;
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
		var code;
		if (this.channels == 2) {
			let data_bytes_per_channel = this.samplesPerBlock - 1;
			var lastByte = -1;
			var chan = [{ sample: 0, index: 0 }, { sample: 0, index: 0 }];
			chan[0].sample = compressedData.readShort();
			chan[0].index = compressedData.readUnsignedByte();
			compressedData.position++;
			chan[1].sample = compressedData.readShort();
			chan[1].index = compressedData.readUnsignedByte();
			compressedData.position++;
			if (chan[0].index > 88) chan[0].index = 88;
			if (chan[1].index > 88) chan[1].index = 88;
			this.writeSample(0, this.sampleIndex++, chan[0].sample / 32768);
			this.writeSample(1, this.sampleIndex++, chan[1].sample / 32768);
			var blockStart = this.sampleIndex / 2;
			var blockLength = Math.min(data_bytes_per_channel, ((size - this.sampleIndex) / 2) | 0);
			for (var i = 0; i < blockLength; i++) {
				var channel = Math.floor(i / 4) & 1;
				var offset = Math.floor(i / 8) * 8;
				let _ = (i * 2) % 8;
				var chs = chan[channel];
				for (var _i = 0; _i < 2; _i++) {
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
					var gr = chs.sample / 32768;
					this.writeSample(channel, blockStart + offset + _ + _i, gr);
					this.sampleIndex += 1;
				}
			}
		} else {
			let data_bytes_per_channel = this.samplesPerBlock - 1;
			var lastByte = -1;
			var sample = compressedData.readShort();
			var index = compressedData.readUnsignedByte();
			compressedData.position++;
			if (index > 88) index = 88;
			this.writeSample(0, this.sampleIndex++, sample / 32768);
			var blockStart = this.sampleIndex;
			var blockLength = Math.min(data_bytes_per_channel, size - this.sampleIndex);
			for (var i = 0; i < blockLength; i++) {
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
	//////// mp3.js ////////
	const BitStream = function(vec) {
		this._end = 0;
		this.viewUint8 = null;
		this.bitPos = 0;
		this.bytePos = 0;
	}
	BitStream.prototype.readBit = function() {
		if (this._end <= this.bytePos) return 0;
		var tmp = (this.viewUint8[this.bytePos] >> (7 - (this.bitPos++)));
		if (this.bitPos > 7) {
			this.bitPos = 0;
			this.bytePos++;
		}
		return tmp & 1;
	}
	BitStream.prototype.get_bits = function(num) {
		if (num === 0) return 0;
		if (this._end <= this.bytePos) return 0;
		var value = 0;
		while (num--) {
			value <<= 1;
			value |= this.readBit();
		}
		return value;
	}
	BitStream.prototype.setData = function(vec) {
		this._end = vec.length;
		this.viewUint8 = vec;
		this.bitPos = 0;
		this.bytePos = 0;
	}
	const MP3Header = function() {
		this.h_layer = 0;
		this.h_protection_bit = 0;
		this.h_bitrate_index = 0;
		this.h_padding_bit = 0;
		this.h_mode_extension = 0;
		this.h_version = 0;
		this.h_mode = 0;
		this.h_sample_frequency = 0;
		this.h_number_of_subbands = 0;
		this.h_intensity_stereo_bound = 0;
		this.h_copyright = 0;
		this.h_original = 0;
		this.h_crc = 0;
		this.framesize = 0;
		this.nSlots = 0;
		this.checksum = 0;
	}
	MP3Header.versionTable = [2, 1, 2.5, -1];
	MP3Header.layerTable = [-1, 3, 2, 1];
	MP3Header.frequencies = [[22050, 24000, 16000], [44100, 48000, 32000], [11025, 12000, 8000]];
	MP3Header.MPEG2_LSF = 0;
	MP3Header.MPEG25_LSF = 2;
	MP3Header.MPEG1 = 1;
	MP3Header.STEREO = 0;
	MP3Header.JOINT_STEREO = 1;
	MP3Header.DUAL_CHANNEL = 2;
	MP3Header.SINGLE_CHANNEL = 3;
	MP3Header.FOURTYFOUR_POINT_ONE = 0;
	MP3Header.FOURTYEIGHT = 1;
	MP3Header.THIRTYTWO = 2;
	MP3Header.bitrates = [[[0, 32000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 176000, 192000, 224000, 256000, 0], [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 0], [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 0]], [[0, 32000, 64000, 96000, 128000, 160000, 192000, 224000, 256000, 288000, 320000, 352000, 384000, 416000, 448000, 0], [0, 32000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 160000, 192000, 224000, 256000, 320000, 384000, 0], [0, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 160000, 192000, 224000, 256000, 320000, 0]], [[0, 32000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 176000, 192000, 224000, 256000, 0], [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 0], [0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000, 160000, 0]]];
	MP3Header.prototype.parseHeader = function(header) {
		this.h_crc = ((header & 0x00010000) >>> 16) >>> 0;
		var channelBitrate = 0;
		this.h_sample_frequency = ((header >>> 10) & 3);
		this.h_version = ((header >>> 19) & 1);
		if (((header >>> 20) & 1) == 0)
			if (this.h_version == MP3Header.MPEG2_LSF)
				this.h_version = MP3Header.MPEG25_LSF;
			else
				throw new Error("UNKNOWN_ERROR");
		this.h_layer = 4 - (header >>> 17) & 3;
		this.h_protection_bit = (header >>> 16) & 1;
		this.h_bitrate_index = (header >>> 12) & 0xF;
		this.h_padding_bit = (header >>> 9) & 1;
		this.h_mode = ((header >>> 6) & 3);
		this.h_mode_extension = (header >>> 4) & 3;
		if (this.h_mode == MP3Header.JOINT_STEREO)
			this.h_intensity_stereo_bound = (this.h_mode_extension << 2) + 4;
		else
			this.h_intensity_stereo_bound = 0; // should never be used
		if (((header >>> 3) & 1) == 1)
			this.h_copyright = true;
		if (((header >>> 2) & 1) == 1)
			this.h_original = true;
		if (this.h_layer == 1)
			this.h_number_of_subbands = 32;
		else {
			channelBitrate = this.h_bitrate_index;
			// calculate bitrate per channel:
			if (this.h_mode != MP3Header.SINGLE_CHANNEL)
				if (channelBitrate == 4)
					channelBitrate = 1;
				else
					channelBitrate -= 4;
			if ((channelBitrate == 1) || (channelBitrate == 2))
				if (this.h_sample_frequency == MP3Header.THIRTYTWO)
					this.h_number_of_subbands = 12;
				else
					this.h_number_of_subbands = 8;
			else if ((this.h_sample_frequency == MP3Header.FOURTYEIGHT) || ((channelBitrate >= 3) && (channelBitrate <= 5)))
				this.h_number_of_subbands = 27;
			else
				this.h_number_of_subbands = 30;
		}
		if (this.h_intensity_stereo_bound > this.h_number_of_subbands)
			this.h_intensity_stereo_bound = this.h_number_of_subbands;
		this.calculate_framesize();
	}
	MP3Header.prototype.frequency = function() {
		return MP3Header.frequencies[this.h_version][this.h_sample_frequency];
	}
	MP3Header.prototype.sample_frequency = function() {
		return this.h_sample_frequency;
	}
	MP3Header.prototype.version = function() {
		return this.h_version;
	}
	MP3Header.prototype.layer = function() {
		return this.h_layer;
	}
	MP3Header.prototype.mode = function() {
		return this.h_mode;
	}
	MP3Header.prototype.checksums = function() {
		return this.h_protection_bit == 0;
	}
	MP3Header.prototype.copyright = function() {
		return this.h_copyright;
	}
	MP3Header.prototype.crc = function() {
		return this.h_crc;
	}
	MP3Header.prototype.original = function() {
		return this.h_original;
	}
	MP3Header.prototype.padding = function() {
		return this.h_padding_bit != 0;
	}
	MP3Header.prototype.slots = function() {
		return this.nSlots;
	}
	MP3Header.prototype.mode_extension = function() {
		return this.h_mode_extension;
	}
	MP3Header.prototype.calculate_framesize = function() {
		if (this.h_layer == 1) {
			this.framesize = ((12 * MP3Header.bitrates[this.h_version][0][this.h_bitrate_index]) / MP3Header.frequencies[this.h_version][this.h_sample_frequency]) | 0;
			if (this.h_padding_bit != 0) this.framesize++;
			this.framesize <<= 2;
			this.nSlots = 0;
		} else {
			this.framesize = ((144 * MP3Header.bitrates[this.h_version][this.h_layer - 1][this.h_bitrate_index]) / MP3Header.frequencies[this.h_version][this.h_sample_frequency]) | 0;
			if (this.h_version == MP3Header.MPEG2_LSF || this.h_version == MP3Header.MPEG25_LSF) this.framesize >>= 1;
			if (this.h_padding_bit != 0) this.framesize++;
			if (this.h_layer == 3) {
				if (this.h_version == MP3Header.MPEG1) {
					this.nSlots = this.framesize - ((this.h_mode == MP3Header.SINGLE_CHANNEL) ? 17 : 32) - ((this.h_protection_bit != 0) ? 0 : 2) - 4; 
				} else {
					this.nSlots = this.framesize - ((this.h_mode == MP3Header.SINGLE_CHANNEL) ? 9 : 17) - ((this.h_protection_bit != 0) ? 0 : 2) - 4;
				}
			} else {
				this.nSlots = 0;
			}
		}
		this.framesize -= 4;
		return this.framesize;
	}
	MP3Header.prototype.layer_string = function() {
		switch (this.h_layer) {
			case 1:
				return "I";
			case 2:
				return "II";
			case 3:
				return "III";
		}
		return null;
	}
	MP3Header.bitrate_str = [[["free format", "32 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "176 kbit/s", "192 kbit/s", "224 kbit/s", "256 kbit/s", "forbidden"], ["free format", "8 kbit/s", "16 kbit/s", "24 kbit/s", "32 kbit/s", "40 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "forbidden"], ["free format", "8 kbit/s", "16 kbit/s", "24 kbit/s", "32 kbit/s", "40 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "forbidden"]], [["free format", "32 kbit/s", "64 kbit/s", "96 kbit/s", "128 kbit/s", "160 kbit/s", "192 kbit/s", "224 kbit/s", "256 kbit/s", "288 kbit/s", "320 kbit/s", "352 kbit/s", "384 kbit/s", "416 kbit/s", "448 kbit/s", "forbidden"], ["free format", "32 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "160 kbit/s", "192 kbit/s", "224 kbit/s", "256 kbit/s", "320 kbit/s", "384 kbit/s", "forbidden"], ["free format", "32 kbit/s", "40 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "160 kbit/s", "192 kbit/s", "224 kbit/s", "256 kbit/s", "320 kbit/s", "forbidden"]], [["free format", "32 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "176 kbit/s", "192 kbit/s", "224 kbit/s", "256 kbit/s", "forbidden"], ["free format", "8 kbit/s", "16 kbit/s", "24 kbit/s", "32 kbit/s", "40 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "forbidden"], ["free format", "8 kbit/s", "16 kbit/s", "24 kbit/s", "32 kbit/s", "40 kbit/s", "48 kbit/s", "56 kbit/s", "64 kbit/s", "80 kbit/s", "96 kbit/s", "112 kbit/s", "128 kbit/s", "144 kbit/s", "160 kbit/s", "forbidden"]]];
	MP3Header.prototype.bitrate_string = function() {
		return MP3Header.bitrate_str[this.h_version][this.h_layer - 1][this.h_bitrate_index];
	}
	MP3Header.prototype.sample_frequency_string = function() {
		switch (h_sample_frequency) {
			case MP3Header.THIRTYTWO:
				if (this.h_version == MP3Header.MPEG1)
					return "32 kHz";
				else if (this.h_version == MP3Header.MPEG2_LSF)
					return "16 kHz";
				else    // SZD
					return "8 kHz";
			case MP3Header.FOURTYFOUR_POINT_ONE:
				if (this.h_version == MP3Header.MPEG1)
					return "44.1 kHz";
				else if (this.h_version == MP3Header.MPEG2_LSF)
					return "22.05 kHz";
				else    // SZD
					return "11.025 kHz";
			case MP3Header.FOURTYEIGHT:
				if (this.h_version == MP3Header.MPEG1)
					return "48 kHz";
				else if (this.h_version == MP3Header.MPEG2_LSF)
					return "24 kHz";
				else    // SZD
					return "12 kHz";
		}
		return null;
	}
	MP3Header.isValidHeader = function(h) {
		return (((h >>> 24) == 0xFF) && (((h >> 21) & 2047) == 2047) && ((((h & 0x00180000) >>> 19) >>> 0) != 1) && ((((h & 0x00060000) >>> 17) >>> 0) != 0) && ((((h & 0x0000f000) >>> 12) >>> 0) != 0) && ((((h & 0x0000f000) >>> 12) >>> 0) != 15) && ((((h & 0x00000c00) >>> 10) >>> 0) != 3) && (((h & 0x00000003) >>> 0) != 2));
	}
	const BitReserve = function() {
		this.offset = 0;
		this.totbit = 0;
		this.buf_byte_idx = 0;
		this.buf = new Int32Array(BitReserve.BUFSIZE);
	}
	BitReserve.BUFSIZE = 4096 * 8;
	BitReserve.BUFSIZE_MASK = BitReserve.BUFSIZE - 1;
	BitReserve.prototype.hputbuf = function(val) {
		var ofs = this.offset;
		this.buf[ofs++] = val & 0x80;
		this.buf[ofs++] = val & 0x40;
		this.buf[ofs++] = val & 0x20;
		this.buf[ofs++] = val & 0x10;
		this.buf[ofs++] = val & 0x08;
		this.buf[ofs++] = val & 0x04;
		this.buf[ofs++] = val & 0x02;
		this.buf[ofs++] = val & 0x01;
		if (ofs == BitReserve.BUFSIZE) this.offset = 0;
		else this.offset = ofs;
	}
	BitReserve.prototype.hsstell = function() {
		return this.totbit;
	}
	BitReserve.prototype.hgetbits = function(N) {
		this.totbit += N;
		var val = 0;
		var pos = this.buf_byte_idx;
		if (pos + N < BitReserve.BUFSIZE) {
			while (N-- > 0) {
				val <<= 1;
				val |= ((this.buf[pos++] != 0) ? 1 : 0);
			}
		} else {
			while (N-- > 0) {
				val <<= 1;
				val |= ((this.buf[pos] != 0) ? 1 : 0);
				pos = (pos + 1) & BitReserve.BUFSIZE_MASK;
			}
		}
		this.buf_byte_idx = pos;
		return val;
	}
	BitReserve.prototype.hget1bit = function() {
		this.totbit++;
		var val = this.buf[this.buf_byte_idx];
		this.buf_byte_idx = (this.buf_byte_idx + 1) & BitReserve.BUFSIZE_MASK;
		return val;
	}
	BitReserve.prototype.rewindNbits = function(N) {
		this.totbit -= N;
		this.buf_byte_idx -= N;
		if (this.buf_byte_idx < 0)
			this.buf_byte_idx += BitReserve.BUFSIZE;
	}
	BitReserve.prototype.rewindNbytes = function(N) {
		var bits = (N << 3);
		this.totbit -= bits;
		this.buf_byte_idx -= bits;
		if (this.buf_byte_idx < 0)
			this.buf_byte_idx += BitReserve.BUFSIZE;
	}
	const huffcodetab = function(S, XLEN, YLEN, LINBITS, LINMAX, REF, VAL, TREELEN) {
		this.tablename0 = S.charAt(0);
		this.tablename1 = S.charAt(1);
		this.tablename2 = S.charAt(2);
		this.xlen = XLEN;
		this.ylen = YLEN;
		this.linbits = LINBITS;
		this.linmax = LINMAX;
		this.ref = REF;
		this.val = VAL;
		this.treelen = TREELEN;
	}
	huffcodetab.MXOFF = 250;
	huffcodetab.ValTab0 = [[0, 0]];
	huffcodetab.ValTab1 = [[2, 1], [0, 0], [2, 1], [0, 16], [2, 1], [0, 1], [0, 17]];
	huffcodetab.ValTab2 = [[2, 1], [0, 0], [4, 1], [2, 1], [0, 16], [0, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 32], [0, 33], [2, 1], [0, 18], [2, 1], [0, 2], [0, 34]];
	huffcodetab.ValTab3 = [[4, 1], [2, 1], [0, 0], [0, 1], [2, 1], [0, 17], [2, 1], [0, 16], [4, 1], [2, 1], [0, 32], [0, 33], [2, 1], [0, 18], [2, 1], [0, 2], [0, 34]];
	huffcodetab.ValTab4 = [[0, 0]];
	huffcodetab.ValTab5 = [[2, 1], [0, 0], [4, 1], [2, 1], [0, 16], [0, 1], [2, 1], [0, 17], [8, 1], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 33], [0, 18], [8, 1], [4, 1], [2, 1], [0, 34], [0, 48], [2, 1], [0, 3], [0, 19], [2, 1], [0, 49], [2, 1], [0, 50], [2, 1], [0, 35], [0, 51]];
	huffcodetab.ValTab6 = [[6, 1], [4, 1], [2, 1], [0, 0], [0, 16], [0, 17], [6, 1], [2, 1], [0, 1], [2, 1], [0, 32], [0, 33], [6, 1], [2, 1], [0, 18], [2, 1], [0, 2], [0, 34], [4, 1], [2, 1], [0, 49], [0, 19], [4, 1], [2, 1], [0, 48], [0, 50], [2, 1], [0, 35], [2, 1], [0, 3], [0, 51]];
	huffcodetab.ValTab7 = [[2, 1], [0, 0], [4, 1], [2, 1], [0, 16], [0, 1], [8, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 32], [0, 2], [0, 33], [18, 1], [6, 1], [2, 1], [0, 18], [2, 1], [0, 34], [0, 48], [4, 1], [2, 1], [0, 49], [0, 19], [4, 1], [2, 1], [0, 3], [0, 50], [2, 1], [0, 35], [0, 4], [10, 1], [4, 1], [2, 1], [0, 64], [0, 65], [2, 1], [0, 20], [2, 1], [0, 66], [0, 36], [12, 1], [6, 1], [4, 1], [2, 1], [0, 51], [0, 67], [0, 80], [4, 1], [2, 1], [0, 52], [0, 5], [0, 81], [6, 1], [2, 1], [0, 21], [2, 1], [0, 82], [0, 37], [4, 1], [2, 1], [0, 68], [0, 53], [4, 1], [2, 1], [0, 83], [0, 84], [2, 1], [0, 69], [0, 85]];
	huffcodetab.ValTab8 = [[6, 1], [2, 1], [0, 0], [2, 1], [0, 16], [0, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 33], [0, 18], [14, 1], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 34], [4, 1], [2, 1], [0, 48], [0, 3], [2, 1], [0, 49], [0, 19], [14, 1], [8, 1], [4, 1], [2, 1], [0, 50], [0, 35], [2, 1], [0, 64], [0, 4], [2, 1], [0, 65], [2, 1], [0, 20], [0, 66], [12, 1], [6, 1], [2, 1], [0, 36], [2, 1], [0, 51], [0, 80], [4, 1], [2, 1], [0, 67], [0, 52], [0, 81], [6, 1], [2, 1], [0, 21], [2, 1], [0, 5], [0, 82], [6, 1], [2, 1], [0, 37], [2, 1], [0, 68], [0, 53], [2, 1], [0, 83], [2, 1], [0, 69], [2, 1], [0, 84], [0, 85]];
	huffcodetab.ValTab9 = [[8, 1], [4, 1], [2, 1], [0, 0], [0, 16], [2, 1], [0, 1], [0, 17], [10, 1], [4, 1], [2, 1], [0, 32], [0, 33], [2, 1], [0, 18], [2, 1], [0, 2], [0, 34], [12, 1], [6, 1], [4, 1], [2, 1], [0, 48], [0, 3], [0, 49], [2, 1], [0, 19], [2, 1], [0, 50], [0, 35], [12, 1], [4, 1], [2, 1], [0, 65], [0, 20], [4, 1], [2, 1], [0, 64], [0, 51], [2, 1], [0, 66], [0, 36], [10, 1], [6, 1], [4, 1], [2, 1], [0, 4], [0, 80], [0, 67], [2, 1], [0, 52], [0, 81], [8, 1], [4, 1], [2, 1], [0, 21], [0, 82], [2, 1], [0, 37], [0, 68], [6, 1], [4, 1], [2, 1], [0, 5], [0, 84], [0, 83], [2, 1], [0, 53], [2, 1], [0, 69], [0, 85]];
	huffcodetab.ValTab10 = [[2, 1], [0, 0], [4, 1], [2, 1], [0, 16], [0, 1], [10, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 33], [0, 18], [28, 1], [8, 1], [4, 1], [2, 1], [0, 34], [0, 48], [2, 1], [0, 49], [0, 19], [8, 1], [4, 1], [2, 1], [0, 3], [0, 50], [2, 1], [0, 35], [0, 64], [4, 1], [2, 1], [0, 65], [0, 20], [4, 1], [2, 1], [0, 4], [0, 51], [2, 1], [0, 66], [0, 36], [28, 1], [10, 1], [6, 1], [4, 1], [2, 1], [0, 80], [0, 5], [0, 96], [2, 1], [0, 97], [0, 22], [12, 1], [6, 1], [4, 1], [2, 1], [0, 67], [0, 52], [0, 81], [2, 1], [0, 21], [2, 1], [0, 82], [0, 37], [4, 1], [2, 1], [0, 38], [0, 54], [0, 113], [20, 1], [8, 1], [2, 1], [0, 23], [4, 1], [2, 1], [0, 68], [0, 83], [0, 6], [6, 1], [4, 1], [2, 1], [0, 53], [0, 69], [0, 98], [2, 1], [0, 112], [2, 1], [0, 7], [0, 100], [14, 1], [4, 1], [2, 1], [0, 114], [0, 39], [6, 1], [2, 1], [0, 99], [2, 1], [0, 84], [0, 85], [2, 1], [0, 70], [0, 115], [8, 1], [4, 1], [2, 1], [0, 55], [0, 101], [2, 1], [0, 86], [0, 116], [6, 1], [2, 1], [0, 71], [2, 1], [0, 102], [0, 117], [4, 1], [2, 1], [0, 87], [0, 118], [2, 1], [0, 103], [0, 119]];
	huffcodetab.ValTab11 = [[6, 1], [2, 1], [0, 0], [2, 1], [0, 16], [0, 1], [8, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 32], [0, 2], [0, 18], [24, 1], [8, 1], [2, 1], [0, 33], [2, 1], [0, 34], [2, 1], [0, 48], [0, 3], [4, 1], [2, 1], [0, 49], [0, 19], [4, 1], [2, 1], [0, 50], [0, 35], [4, 1], [2, 1], [0, 64], [0, 4], [2, 1], [0, 65], [0, 20], [30, 1], [16, 1], [10, 1], [4, 1], [2, 1], [0, 66], [0, 36], [4, 1], [2, 1], [0, 51], [0, 67], [0, 80], [4, 1], [2, 1], [0, 52], [0, 81], [0, 97], [6, 1], [2, 1], [0, 22], [2, 1], [0, 6], [0, 38], [2, 1], [0, 98], [2, 1], [0, 21], [2, 1], [0, 5], [0, 82], [16, 1], [10, 1], [6, 1], [4, 1], [2, 1], [0, 37], [0, 68], [0, 96], [2, 1], [0, 99], [0, 54], [4, 1], [2, 1], [0, 112], [0, 23], [0, 113], [16, 1], [6, 1], [4, 1], [2, 1], [0, 7], [0, 100], [0, 114], [2, 1], [0, 39], [4, 1], [2, 1], [0, 83], [0, 53], [2, 1], [0, 84], [0, 69], [10, 1], [4, 1], [2, 1], [0, 70], [0, 115], [2, 1], [0, 55], [2, 1], [0, 101], [0, 86], [10, 1], [6, 1], [4, 1], [2, 1], [0, 85], [0, 87], [0, 116], [2, 1], [0, 71], [0, 102], [4, 1], [2, 1], [0, 117], [0, 118], [2, 1], [0, 103], [0, 119]];
	huffcodetab.ValTab12 = [[12, 1], [4, 1], [2, 1], [0, 16], [0, 1], [2, 1], [0, 17], [2, 1], [0, 0], [2, 1], [0, 32], [0, 2], [16, 1], [4, 1], [2, 1], [0, 33], [0, 18], [4, 1], [2, 1], [0, 34], [0, 49], [2, 1], [0, 19], [2, 1], [0, 48], [2, 1], [0, 3], [0, 64], [26, 1], [8, 1], [4, 1], [2, 1], [0, 50], [0, 35], [2, 1], [0, 65], [0, 51], [10, 1], [4, 1], [2, 1], [0, 20], [0, 66], [2, 1], [0, 36], [2, 1], [0, 4], [0, 80], [4, 1], [2, 1], [0, 67], [0, 52], [2, 1], [0, 81], [0, 21], [28, 1], [14, 1], [8, 1], [4, 1], [2, 1], [0, 82], [0, 37], [2, 1], [0, 83], [0, 53], [4, 1], [2, 1], [0, 96], [0, 22], [0, 97], [4, 1], [2, 1], [0, 98], [0, 38], [6, 1], [4, 1], [2, 1], [0, 5], [0, 6], [0, 68], [2, 1], [0, 84], [0, 69], [18, 1], [10, 1], [4, 1], [2, 1], [0, 99], [0, 54], [4, 1], [2, 1], [0, 112], [0, 7], [0, 113], [4, 1], [2, 1], [0, 23], [0, 100], [2, 1], [0, 70], [0, 114], [10, 1], [6, 1], [2, 1], [0, 39], [2, 1], [0, 85], [0, 115], [2, 1], [0, 55], [0, 86], [8, 1], [4, 1], [2, 1], [0, 101], [0, 116], [2, 1], [0, 71], [0, 102], [4, 1], [2, 1], [0, 117], [0, 87], [2, 1], [0, 118], [2, 1], [0, 103], [0, 119]];
	huffcodetab.ValTab13 = [[2, 1], [0, 0], [6, 1], [2, 1], [0, 16], [2, 1], [0, 1], [0, 17], [28, 1], [8, 1], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 33], [0, 18], [8, 1], [4, 1], [2, 1], [0, 34], [0, 48], [2, 1], [0, 3], [0, 49], [6, 1], [2, 1], [0, 19], [2, 1], [0, 50], [0, 35], [4, 1], [2, 1], [0, 64], [0, 4], [0, 65], [70, 1], [28, 1], [14, 1], [6, 1], [2, 1], [0, 20], [2, 1], [0, 51], [0, 66], [4, 1], [2, 1], [0, 36], [0, 80], [2, 1], [0, 67], [0, 52], [4, 1], [2, 1], [0, 81], [0, 21], [4, 1], [2, 1], [0, 5], [0, 82], [2, 1], [0, 37], [2, 1], [0, 68], [0, 83], [14, 1], [8, 1], [4, 1], [2, 1], [0, 96], [0, 6], [2, 1], [0, 97], [0, 22], [4, 1], [2, 1], [0, 128], [0, 8], [0, 129], [16, 1], [8, 1], [4, 1], [2, 1], [0, 53], [0, 98], [2, 1], [0, 38], [0, 84], [4, 1], [2, 1], [0, 69], [0, 99], [2, 1], [0, 54], [0, 112], [6, 1], [4, 1], [2, 1], [0, 7], [0, 85], [0, 113], [2, 1], [0, 23], [2, 1], [0, 39], [0, 55], [72, 1], [24, 1], [12, 1], [4, 1], [2, 1], [0, 24], [0, 130], [2, 1], [0, 40], [4, 1], [2, 1], [0, 100], [0, 70], [0, 114], [8, 1], [4, 1], [2, 1], [0, 132], [0, 72], [2, 1], [0, 144], [0, 9], [2, 1], [0, 145], [0, 25], [24, 1], [14, 1], [8, 1], [4, 1], [2, 1], [0, 115], [0, 101], [2, 1], [0, 86], [0, 116], [4, 1], [2, 1], [0, 71], [0, 102], [0, 131], [6, 1], [2, 1], [0, 56], [2, 1], [0, 117], [0, 87], [2, 1], [0, 146], [0, 41], [14, 1], [8, 1], [4, 1], [2, 1], [0, 103], [0, 133], [2, 1], [0, 88], [0, 57], [2, 1], [0, 147], [2, 1], [0, 73], [0, 134], [6, 1], [2, 1], [0, 160], [2, 1], [0, 104], [0, 10], [2, 1], [0, 161], [0, 26], [68, 1], [24, 1], [12, 1], [4, 1], [2, 1], [0, 162], [0, 42], [4, 1], [2, 1], [0, 149], [0, 89], [2, 1], [0, 163], [0, 58], [8, 1], [4, 1], [2, 1], [0, 74], [0, 150], [2, 1], [0, 176], [0, 11], [2, 1], [0, 177], [0, 27], [20, 1], [8, 1], [2, 1], [0, 178], [4, 1], [2, 1], [0, 118], [0, 119], [0, 148], [6, 1], [4, 1], [2, 1], [0, 135], [0, 120], [0, 164], [4, 1], [2, 1], [0, 105], [0, 165], [0, 43], [12, 1], [6, 1], [4, 1], [2, 1], [0, 90], [0, 136], [0, 179], [2, 1], [0, 59], [2, 1], [0, 121], [0, 166], [6, 1], [4, 1], [2, 1], [0, 106], [0, 180], [0, 192], [4, 1], [2, 1], [0, 12], [0, 152], [0, 193], [60, 1], [22, 1], [10, 1], [6, 1], [2, 1], [0, 28], [2, 1], [0, 137], [0, 181], [2, 1], [0, 91], [0, 194], [4, 1], [2, 1], [0, 44], [0, 60], [4, 1], [2, 1], [0, 182], [0, 107], [2, 1], [0, 196], [0, 76], [16, 1], [8, 1], [4, 1], [2, 1], [0, 168], [0, 138], [2, 1], [0, 208], [0, 13], [2, 1], [0, 209], [2, 1], [0, 75], [2, 1], [0, 151], [0, 167], [12, 1], [6, 1], [2, 1], [0, 195], [2, 1], [0, 122], [0, 153], [4, 1], [2, 1], [0, 197], [0, 92], [0, 183], [4, 1], [2, 1], [0, 29], [0, 210], [2, 1], [0, 45], [2, 1], [0, 123], [0, 211], [52, 1], [28, 1], [12, 1], [4, 1], [2, 1], [0, 61], [0, 198], [4, 1], [2, 1], [0, 108], [0, 169], [2, 1], [0, 154], [0, 212], [8, 1], [4, 1], [2, 1], [0, 184], [0, 139], [2, 1], [0, 77], [0, 199], [4, 1], [2, 1], [0, 124], [0, 213], [2, 1], [0, 93], [0, 224], [10, 1], [4, 1], [2, 1], [0, 225], [0, 30], [4, 1], [2, 1], [0, 14], [0, 46], [0, 226], [8, 1], [4, 1], [2, 1], [0, 227], [0, 109], [2, 1], [0, 140], [0, 228], [4, 1], [2, 1], [0, 229], [0, 186], [0, 240], [38, 1], [16, 1], [4, 1], [2, 1], [0, 241], [0, 31], [6, 1], [4, 1], [2, 1], [0, 170], [0, 155], [0, 185], [2, 1], [0, 62], [2, 1], [0, 214], [0, 200], [12, 1], [6, 1], [2, 1], [0, 78], [2, 1], [0, 215], [0, 125], [2, 1], [0, 171], [2, 1], [0, 94], [0, 201], [6, 1], [2, 1], [0, 15], [2, 1], [0, 156], [0, 110], [2, 1], [0, 242], [0, 47], [32, 1], [16, 1], [6, 1], [4, 1], [2, 1], [0, 216], [0, 141], [0, 63], [6, 1], [2, 1], [0, 243], [2, 1], [0, 230], [0, 202], [2, 1], [0, 244], [0, 79], [8, 1], [4, 1], [2, 1], [0, 187], [0, 172], [2, 1], [0, 231], [0, 245], [4, 1], [2, 1], [0, 217], [0, 157], [2, 1], [0, 95], [0, 232], [30, 1], [12, 1], [6, 1], [2, 1], [0, 111], [2, 1], [0, 246], [0, 203], [4, 1], [2, 1], [0, 188], [0, 173], [0, 218], [8, 1], [2, 1], [0, 247], [4, 1], [2, 1], [0, 126], [0, 127], [0, 142], [6, 1], [4, 1], [2, 1], [0, 158], [0, 174], [0, 204], [2, 1], [0, 248], [0, 143], [18, 1], [8, 1], [4, 1], [2, 1], [0, 219], [0, 189], [2, 1], [0, 234], [0, 249], [4, 1], [2, 1], [0, 159], [0, 235], [2, 1], [0, 190], [2, 1], [0, 205], [0, 250], [14, 1], [4, 1], [2, 1], [0, 221], [0, 236], [6, 1], [4, 1], [2, 1], [0, 233], [0, 175], [0, 220], [2, 1], [0, 206], [0, 251], [8, 1], [4, 1], [2, 1], [0, 191], [0, 222], [2, 1], [0, 207], [0, 238], [4, 1], [2, 1], [0, 223], [0, 239], [2, 1], [0, 255], [2, 1], [0, 237], [2, 1], [0, 253], [2, 1], [0, 252], [0, 254]];
	huffcodetab.ValTab14 = [[0, 0]];
	huffcodetab.ValTab15 = [[16, 1], [6, 1], [2, 1], [0, 0], [2, 1], [0, 16], [0, 1], [2, 1], [0, 17], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 33], [0, 18], [50, 1], [16, 1], [6, 1], [2, 1], [0, 34], [2, 1], [0, 48], [0, 49], [6, 1], [2, 1], [0, 19], [2, 1], [0, 3], [0, 64], [2, 1], [0, 50], [0, 35], [14, 1], [6, 1], [4, 1], [2, 1], [0, 4], [0, 20], [0, 65], [4, 1], [2, 1], [0, 51], [0, 66], [2, 1], [0, 36], [0, 67], [10, 1], [6, 1], [2, 1], [0, 52], [2, 1], [0, 80], [0, 5], [2, 1], [0, 81], [0, 21], [4, 1], [2, 1], [0, 82], [0, 37], [4, 1], [2, 1], [0, 68], [0, 83], [0, 97], [90, 1], [36, 1], [18, 1], [10, 1], [6, 1], [2, 1], [0, 53], [2, 1], [0, 96], [0, 6], [2, 1], [0, 22], [0, 98], [4, 1], [2, 1], [0, 38], [0, 84], [2, 1], [0, 69], [0, 99], [10, 1], [6, 1], [2, 1], [0, 54], [2, 1], [0, 112], [0, 7], [2, 1], [0, 113], [0, 85], [4, 1], [2, 1], [0, 23], [0, 100], [2, 1], [0, 114], [0, 39], [24, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 70], [0, 115], [2, 1], [0, 55], [0, 101], [4, 1], [2, 1], [0, 86], [0, 128], [2, 1], [0, 8], [0, 116], [4, 1], [2, 1], [0, 129], [0, 24], [2, 1], [0, 130], [0, 40], [16, 1], [8, 1], [4, 1], [2, 1], [0, 71], [0, 102], [2, 1], [0, 131], [0, 56], [4, 1], [2, 1], [0, 117], [0, 87], [2, 1], [0, 132], [0, 72], [6, 1], [4, 1], [2, 1], [0, 144], [0, 25], [0, 145], [4, 1], [2, 1], [0, 146], [0, 118], [2, 1], [0, 103], [0, 41], [92, 1], [36, 1], [18, 1], [10, 1], [4, 1], [2, 1], [0, 133], [0, 88], [4, 1], [2, 1], [0, 9], [0, 119], [0, 147], [4, 1], [2, 1], [0, 57], [0, 148], [2, 1], [0, 73], [0, 134], [10, 1], [6, 1], [2, 1], [0, 104], [2, 1], [0, 160], [0, 10], [2, 1], [0, 161], [0, 26], [4, 1], [2, 1], [0, 162], [0, 42], [2, 1], [0, 149], [0, 89], [26, 1], [14, 1], [6, 1], [2, 1], [0, 163], [2, 1], [0, 58], [0, 135], [4, 1], [2, 1], [0, 120], [0, 164], [2, 1], [0, 74], [0, 150], [6, 1], [4, 1], [2, 1], [0, 105], [0, 176], [0, 177], [4, 1], [2, 1], [0, 27], [0, 165], [0, 178], [14, 1], [8, 1], [4, 1], [2, 1], [0, 90], [0, 43], [2, 1], [0, 136], [0, 151], [2, 1], [0, 179], [2, 1], [0, 121], [0, 59], [8, 1], [4, 1], [2, 1], [0, 106], [0, 180], [2, 1], [0, 75], [0, 193], [4, 1], [2, 1], [0, 152], [0, 137], [2, 1], [0, 28], [0, 181], [80, 1], [34, 1], [16, 1], [6, 1], [4, 1], [2, 1], [0, 91], [0, 44], [0, 194], [6, 1], [4, 1], [2, 1], [0, 11], [0, 192], [0, 166], [2, 1], [0, 167], [0, 122], [10, 1], [4, 1], [2, 1], [0, 195], [0, 60], [4, 1], [2, 1], [0, 12], [0, 153], [0, 182], [4, 1], [2, 1], [0, 107], [0, 196], [2, 1], [0, 76], [0, 168], [20, 1], [10, 1], [4, 1], [2, 1], [0, 138], [0, 197], [4, 1], [2, 1], [0, 208], [0, 92], [0, 209], [4, 1], [2, 1], [0, 183], [0, 123], [2, 1], [0, 29], [2, 1], [0, 13], [0, 45], [12, 1], [4, 1], [2, 1], [0, 210], [0, 211], [4, 1], [2, 1], [0, 61], [0, 198], [2, 1], [0, 108], [0, 169], [6, 1], [4, 1], [2, 1], [0, 154], [0, 184], [0, 212], [4, 1], [2, 1], [0, 139], [0, 77], [2, 1], [0, 199], [0, 124], [68, 1], [34, 1], [18, 1], [10, 1], [4, 1], [2, 1], [0, 213], [0, 93], [4, 1], [2, 1], [0, 224], [0, 14], [0, 225], [4, 1], [2, 1], [0, 30], [0, 226], [2, 1], [0, 170], [0, 46], [8, 1], [4, 1], [2, 1], [0, 185], [0, 155], [2, 1], [0, 227], [0, 214], [4, 1], [2, 1], [0, 109], [0, 62], [2, 1], [0, 200], [0, 140], [16, 1], [8, 1], [4, 1], [2, 1], [0, 228], [0, 78], [2, 1], [0, 215], [0, 125], [4, 1], [2, 1], [0, 229], [0, 186], [2, 1], [0, 171], [0, 94], [8, 1], [4, 1], [2, 1], [0, 201], [0, 156], [2, 1], [0, 241], [0, 31], [6, 1], [4, 1], [2, 1], [0, 240], [0, 110], [0, 242], [2, 1], [0, 47], [0, 230], [38, 1], [18, 1], [8, 1], [4, 1], [2, 1], [0, 216], [0, 243], [2, 1], [0, 63], [0, 244], [6, 1], [2, 1], [0, 79], [2, 1], [0, 141], [0, 217], [2, 1], [0, 187], [0, 202], [8, 1], [4, 1], [2, 1], [0, 172], [0, 231], [2, 1], [0, 126], [0, 245], [8, 1], [4, 1], [2, 1], [0, 157], [0, 95], [2, 1], [0, 232], [0, 142], [2, 1], [0, 246], [0, 203], [34, 1], [18, 1], [10, 1], [6, 1], [4, 1], [2, 1], [0, 15], [0, 174], [0, 111], [2, 1], [0, 188], [0, 218], [4, 1], [2, 1], [0, 173], [0, 247], [2, 1], [0, 127], [0, 233], [8, 1], [4, 1], [2, 1], [0, 158], [0, 204], [2, 1], [0, 248], [0, 143], [4, 1], [2, 1], [0, 219], [0, 189], [2, 1], [0, 234], [0, 249], [16, 1], [8, 1], [4, 1], [2, 1], [0, 159], [0, 220], [2, 1], [0, 205], [0, 235], [4, 1], [2, 1], [0, 190], [0, 250], [2, 1], [0, 175], [0, 221], [14, 1], [6, 1], [4, 1], [2, 1], [0, 236], [0, 206], [0, 251], [4, 1], [2, 1], [0, 191], [0, 237], [2, 1], [0, 222], [0, 252], [6, 1], [4, 1], [2, 1], [0, 207], [0, 253], [0, 238], [4, 1], [2, 1], [0, 223], [0, 254], [2, 1], [0, 239], [0, 255]];
	huffcodetab.ValTab16 = [[2, 1], [0, 0], [6, 1], [2, 1], [0, 16], [2, 1], [0, 1], [0, 17], [42, 1], [8, 1], [4, 1], [2, 1], [0, 32], [0, 2], [2, 1], [0, 33], [0, 18], [10, 1], [6, 1], [2, 1], [0, 34], [2, 1], [0, 48], [0, 3], [2, 1], [0, 49], [0, 19], [10, 1], [4, 1], [2, 1], [0, 50], [0, 35], [4, 1], [2, 1], [0, 64], [0, 4], [0, 65], [6, 1], [2, 1], [0, 20], [2, 1], [0, 51], [0, 66], [4, 1], [2, 1], [0, 36], [0, 80], [2, 1], [0, 67], [0, 52], [138, 1], [40, 1], [16, 1], [6, 1], [4, 1], [2, 1], [0, 5], [0, 21], [0, 81], [4, 1], [2, 1], [0, 82], [0, 37], [4, 1], [2, 1], [0, 68], [0, 53], [0, 83], [10, 1], [6, 1], [4, 1], [2, 1], [0, 96], [0, 6], [0, 97], [2, 1], [0, 22], [0, 98], [8, 1], [4, 1], [2, 1], [0, 38], [0, 84], [2, 1], [0, 69], [0, 99], [4, 1], [2, 1], [0, 54], [0, 112], [0, 113], [40, 1], [18, 1], [8, 1], [2, 1], [0, 23], [2, 1], [0, 7], [2, 1], [0, 85], [0, 100], [4, 1], [2, 1], [0, 114], [0, 39], [4, 1], [2, 1], [0, 70], [0, 101], [0, 115], [10, 1], [6, 1], [2, 1], [0, 55], [2, 1], [0, 86], [0, 8], [2, 1], [0, 128], [0, 129], [6, 1], [2, 1], [0, 24], [2, 1], [0, 116], [0, 71], [2, 1], [0, 130], [2, 1], [0, 40], [0, 102], [24, 1], [14, 1], [8, 1], [4, 1], [2, 1], [0, 131], [0, 56], [2, 1], [0, 117], [0, 132], [4, 1], [2, 1], [0, 72], [0, 144], [0, 145], [6, 1], [2, 1], [0, 25], [2, 1], [0, 9], [0, 118], [2, 1], [0, 146], [0, 41], [14, 1], [8, 1], [4, 1], [2, 1], [0, 133], [0, 88], [2, 1], [0, 147], [0, 57], [4, 1], [2, 1], [0, 160], [0, 10], [0, 26], [8, 1], [2, 1], [0, 162], [2, 1], [0, 103], [2, 1], [0, 87], [0, 73], [6, 1], [2, 1], [0, 148], [2, 1], [0, 119], [0, 134], [2, 1], [0, 161], [2, 1], [0, 104], [0, 149], [220, 1], [126, 1], [50, 1], [26, 1], [12, 1], [6, 1], [2, 1], [0, 42], [2, 1], [0, 89], [0, 58], [2, 1], [0, 163], [2, 1], [0, 135], [0, 120], [8, 1], [4, 1], [2, 1], [0, 164], [0, 74], [2, 1], [0, 150], [0, 105], [4, 1], [2, 1], [0, 176], [0, 11], [0, 177], [10, 1], [4, 1], [2, 1], [0, 27], [0, 178], [2, 1], [0, 43], [2, 1], [0, 165], [0, 90], [6, 1], [2, 1], [0, 179], [2, 1], [0, 166], [0, 106], [4, 1], [2, 1], [0, 180], [0, 75], [2, 1], [0, 12], [0, 193], [30, 1], [14, 1], [6, 1], [4, 1], [2, 1], [0, 181], [0, 194], [0, 44], [4, 1], [2, 1], [0, 167], [0, 195], [2, 1], [0, 107], [0, 196], [8, 1], [2, 1], [0, 29], [4, 1], [2, 1], [0, 136], [0, 151], [0, 59], [4, 1], [2, 1], [0, 209], [0, 210], [2, 1], [0, 45], [0, 211], [18, 1], [6, 1], [4, 1], [2, 1], [0, 30], [0, 46], [0, 226], [6, 1], [4, 1], [2, 1], [0, 121], [0, 152], [0, 192], [2, 1], [0, 28], [2, 1], [0, 137], [0, 91], [14, 1], [6, 1], [2, 1], [0, 60], [2, 1], [0, 122], [0, 182], [4, 1], [2, 1], [0, 76], [0, 153], [2, 1], [0, 168], [0, 138], [6, 1], [2, 1], [0, 13], [2, 1], [0, 197], [0, 92], [4, 1], [2, 1], [0, 61], [0, 198], [2, 1], [0, 108], [0, 154], [88, 1], [86, 1], [36, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 139], [0, 77], [2, 1], [0, 199], [0, 124], [4, 1], [2, 1], [0, 213], [0, 93], [2, 1], [0, 224], [0, 14], [8, 1], [2, 1], [0, 227], [4, 1], [2, 1], [0, 208], [0, 183], [0, 123], [6, 1], [4, 1], [2, 1], [0, 169], [0, 184], [0, 212], [2, 1], [0, 225], [2, 1], [0, 170], [0, 185], [24, 1], [10, 1], [6, 1], [4, 1], [2, 1], [0, 155], [0, 214], [0, 109], [2, 1], [0, 62], [0, 200], [6, 1], [4, 1], [2, 1], [0, 140], [0, 228], [0, 78], [4, 1], [2, 1], [0, 215], [0, 229], [2, 1], [0, 186], [0, 171], [12, 1], [4, 1], [2, 1], [0, 156], [0, 230], [4, 1], [2, 1], [0, 110], [0, 216], [2, 1], [0, 141], [0, 187], [8, 1], [4, 1], [2, 1], [0, 231], [0, 157], [2, 1], [0, 232], [0, 142], [4, 1], [2, 1], [0, 203], [0, 188], [0, 158], [0, 241], [2, 1], [0, 31], [2, 1], [0, 15], [0, 47], [66, 1], [56, 1], [2, 1], [0, 242], [52, 1], [50, 1], [20, 1], [8, 1], [2, 1], [0, 189], [2, 1], [0, 94], [2, 1], [0, 125], [0, 201], [6, 1], [2, 1], [0, 202], [2, 1], [0, 172], [0, 126], [4, 1], [2, 1], [0, 218], [0, 173], [0, 204], [10, 1], [6, 1], [2, 1], [0, 174], [2, 1], [0, 219], [0, 220], [2, 1], [0, 205], [0, 190], [6, 1], [4, 1], [2, 1], [0, 235], [0, 237], [0, 238], [6, 1], [4, 1], [2, 1], [0, 217], [0, 234], [0, 233], [2, 1], [0, 222], [4, 1], [2, 1], [0, 221], [0, 236], [0, 206], [0, 63], [0, 240], [4, 1], [2, 1], [0, 243], [0, 244], [2, 1], [0, 79], [2, 1], [0, 245], [0, 95], [10, 1], [2, 1], [0, 255], [4, 1], [2, 1], [0, 246], [0, 111], [2, 1], [0, 247], [0, 127], [12, 1], [6, 1], [2, 1], [0, 143], [2, 1], [0, 248], [0, 249], [4, 1], [2, 1], [0, 159], [0, 250], [0, 175], [8, 1], [4, 1], [2, 1], [0, 251], [0, 191], [2, 1], [0, 252], [0, 207], [4, 1], [2, 1], [0, 253], [0, 223], [2, 1], [0, 254], [0, 239]];
	huffcodetab.ValTab24 = [[60, 1], [8, 1], [4, 1], [2, 1], [0, 0], [0, 16], [2, 1], [0, 1], [0, 17], [14, 1], [6, 1], [4, 1], [2, 1], [0, 32], [0, 2], [0, 33], [2, 1], [0, 18], [2, 1], [0, 34], [2, 1], [0, 48], [0, 3], [14, 1], [4, 1], [2, 1], [0, 49], [0, 19], [4, 1], [2, 1], [0, 50], [0, 35], [4, 1], [2, 1], [0, 64], [0, 4], [0, 65], [8, 1], [4, 1], [2, 1], [0, 20], [0, 51], [2, 1], [0, 66], [0, 36], [6, 1], [4, 1], [2, 1], [0, 67], [0, 52], [0, 81], [6, 1], [4, 1], [2, 1], [0, 80], [0, 5], [0, 21], [2, 1], [0, 82], [0, 37], [250, 1], [98, 1], [34, 1], [18, 1], [10, 1], [4, 1], [2, 1], [0, 68], [0, 83], [2, 1], [0, 53], [2, 1], [0, 96], [0, 6], [4, 1], [2, 1], [0, 97], [0, 22], [2, 1], [0, 98], [0, 38], [8, 1], [4, 1], [2, 1], [0, 84], [0, 69], [2, 1], [0, 99], [0, 54], [4, 1], [2, 1], [0, 113], [0, 85], [2, 1], [0, 100], [0, 70], [32, 1], [14, 1], [6, 1], [2, 1], [0, 114], [2, 1], [0, 39], [0, 55], [2, 1], [0, 115], [4, 1], [2, 1], [0, 112], [0, 7], [0, 23], [10, 1], [4, 1], [2, 1], [0, 101], [0, 86], [4, 1], [2, 1], [0, 128], [0, 8], [0, 129], [4, 1], [2, 1], [0, 116], [0, 71], [2, 1], [0, 24], [0, 130], [16, 1], [8, 1], [4, 1], [2, 1], [0, 40], [0, 102], [2, 1], [0, 131], [0, 56], [4, 1], [2, 1], [0, 117], [0, 87], [2, 1], [0, 132], [0, 72], [8, 1], [4, 1], [2, 1], [0, 145], [0, 25], [2, 1], [0, 146], [0, 118], [4, 1], [2, 1], [0, 103], [0, 41], [2, 1], [0, 133], [0, 88], [92, 1], [34, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 147], [0, 57], [2, 1], [0, 148], [0, 73], [4, 1], [2, 1], [0, 119], [0, 134], [2, 1], [0, 104], [0, 161], [8, 1], [4, 1], [2, 1], [0, 162], [0, 42], [2, 1], [0, 149], [0, 89], [4, 1], [2, 1], [0, 163], [0, 58], [2, 1], [0, 135], [2, 1], [0, 120], [0, 74], [22, 1], [12, 1], [4, 1], [2, 1], [0, 164], [0, 150], [4, 1], [2, 1], [0, 105], [0, 177], [2, 1], [0, 27], [0, 165], [6, 1], [2, 1], [0, 178], [2, 1], [0, 90], [0, 43], [2, 1], [0, 136], [0, 179], [16, 1], [10, 1], [6, 1], [2, 1], [0, 144], [2, 1], [0, 9], [0, 160], [2, 1], [0, 151], [0, 121], [4, 1], [2, 1], [0, 166], [0, 106], [0, 180], [12, 1], [6, 1], [2, 1], [0, 26], [2, 1], [0, 10], [0, 176], [2, 1], [0, 59], [2, 1], [0, 11], [0, 192], [4, 1], [2, 1], [0, 75], [0, 193], [2, 1], [0, 152], [0, 137], [67, 1], [34, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 28], [0, 181], [2, 1], [0, 91], [0, 194], [4, 1], [2, 1], [0, 44], [0, 167], [2, 1], [0, 122], [0, 195], [10, 1], [6, 1], [2, 1], [0, 60], [2, 1], [0, 12], [0, 208], [2, 1], [0, 182], [0, 107], [4, 1], [2, 1], [0, 196], [0, 76], [2, 1], [0, 153], [0, 168], [16, 1], [8, 1], [4, 1], [2, 1], [0, 138], [0, 197], [2, 1], [0, 92], [0, 209], [4, 1], [2, 1], [0, 183], [0, 123], [2, 1], [0, 29], [0, 210], [9, 1], [4, 1], [2, 1], [0, 45], [0, 211], [2, 1], [0, 61], [0, 198], [85, 250], [4, 1], [2, 1], [0, 108], [0, 169], [2, 1], [0, 154], [0, 212], [32, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 184], [0, 139], [2, 1], [0, 77], [0, 199], [4, 1], [2, 1], [0, 124], [0, 213], [2, 1], [0, 93], [0, 225], [8, 1], [4, 1], [2, 1], [0, 30], [0, 226], [2, 1], [0, 170], [0, 185], [4, 1], [2, 1], [0, 155], [0, 227], [2, 1], [0, 214], [0, 109], [20, 1], [10, 1], [6, 1], [2, 1], [0, 62], [2, 1], [0, 46], [0, 78], [2, 1], [0, 200], [0, 140], [4, 1], [2, 1], [0, 228], [0, 215], [4, 1], [2, 1], [0, 125], [0, 171], [0, 229], [10, 1], [4, 1], [2, 1], [0, 186], [0, 94], [2, 1], [0, 201], [2, 1], [0, 156], [0, 110], [8, 1], [2, 1], [0, 230], [2, 1], [0, 13], [2, 1], [0, 224], [0, 14], [4, 1], [2, 1], [0, 216], [0, 141], [2, 1], [0, 187], [0, 202], [74, 1], [2, 1], [0, 255], [64, 1], [58, 1], [32, 1], [16, 1], [8, 1], [4, 1], [2, 1], [0, 172], [0, 231], [2, 1], [0, 126], [0, 217], [4, 1], [2, 1], [0, 157], [0, 232], [2, 1], [0, 142], [0, 203], [8, 1], [4, 1], [2, 1], [0, 188], [0, 218], [2, 1], [0, 173], [0, 233], [4, 1], [2, 1], [0, 158], [0, 204], [2, 1], [0, 219], [0, 189], [16, 1], [8, 1], [4, 1], [2, 1], [0, 234], [0, 174], [2, 1], [0, 220], [0, 205], [4, 1], [2, 1], [0, 235], [0, 190], [2, 1], [0, 221], [0, 236], [8, 1], [4, 1], [2, 1], [0, 206], [0, 237], [2, 1], [0, 222], [0, 238], [0, 15], [4, 1], [2, 1], [0, 240], [0, 31], [0, 241], [4, 1], [2, 1], [0, 242], [0, 47], [2, 1], [0, 243], [0, 63], [18, 1], [8, 1], [4, 1], [2, 1], [0, 244], [0, 79], [2, 1], [0, 245], [0, 95], [4, 1], [2, 1], [0, 246], [0, 111], [2, 1], [0, 247], [2, 1], [0, 127], [0, 143], [10, 1], [4, 1], [2, 1], [0, 248], [0, 249], [4, 1], [2, 1], [0, 159], [0, 175], [0, 250], [8, 1], [4, 1], [2, 1], [0, 251], [0, 191], [2, 1], [0, 252], [0, 207], [4, 1], [2, 1], [0, 253], [0, 223], [2, 1], [0, 254], [0, 239]];
	huffcodetab.ValTab32 = [[2, 1], [0, 0], [8, 1], [4, 1], [2, 1], [0, 8], [0, 4], [2, 1], [0, 1], [0, 2], [8, 1], [4, 1], [2, 1], [0, 12], [0, 10], [2, 1], [0, 3], [0, 6], [6, 1], [2, 1], [0, 9], [2, 1], [0, 5], [0, 7], [4, 1], [2, 1], [0, 14], [0, 13], [2, 1], [0, 15], [0, 11]];huffcodetab.ValTab33 = [[16, 1], [8, 1], [4, 1], [2, 1], [0, 0], [0, 1], [2, 1], [0, 2], [0, 3], [4, 1], [2, 1], [0, 4], [0, 5], [2, 1], [0, 6], [0, 7], [8, 1], [4, 1], [2, 1], [0, 8], [0, 9], [2, 1], [0, 10], [0, 11], [4, 1], [2, 1], [0, 12], [0, 13], [2, 1], [0, 14], [0, 15]];
	huffcodetab.ht = null;
	huffcodetab.initHuff = function() {
		if (huffcodetab.ht != null) return;
		huffcodetab.ht = [];
		huffcodetab.ht[0] = new huffcodetab("0  ", 0, 0, 0, 0, -1, huffcodetab.ValTab0, 0);
		huffcodetab.ht[1] = new huffcodetab("1  ", 2, 2, 0, 0, -1, huffcodetab.ValTab1, 7);
		huffcodetab.ht[2] = new huffcodetab("2  ", 3, 3, 0, 0, -1, huffcodetab.ValTab2, 17);
		huffcodetab.ht[3] = new huffcodetab("3  ", 3, 3, 0, 0, -1, huffcodetab.ValTab3, 17);
		huffcodetab.ht[4] = new huffcodetab("4  ", 0, 0, 0, 0, -1, huffcodetab.ValTab4, 0);
		huffcodetab.ht[5] = new huffcodetab("5  ", 4, 4, 0, 0, -1, huffcodetab.ValTab5, 31);
		huffcodetab.ht[6] = new huffcodetab("6  ", 4, 4, 0, 0, -1, huffcodetab.ValTab6, 31);
		huffcodetab.ht[7] = new huffcodetab("7  ", 6, 6, 0, 0, -1, huffcodetab.ValTab7, 71);
		huffcodetab.ht[8] = new huffcodetab("8  ", 6, 6, 0, 0, -1, huffcodetab.ValTab8, 71);
		huffcodetab.ht[9] = new huffcodetab("9  ", 6, 6, 0, 0, -1, huffcodetab.ValTab9, 71);
		huffcodetab.ht[10] = new huffcodetab("10 ", 8, 8, 0, 0, -1, huffcodetab.ValTab10, 127);
		huffcodetab.ht[11] = new huffcodetab("11 ", 8, 8, 0, 0, -1, huffcodetab.ValTab11, 127);
		huffcodetab.ht[12] = new huffcodetab("12 ", 8, 8, 0, 0, -1, huffcodetab.ValTab12, 127);
		huffcodetab.ht[13] = new huffcodetab("13 ", 16, 16, 0, 0, -1, huffcodetab.ValTab13, 511);
		huffcodetab.ht[14] = new huffcodetab("14 ", 0, 0, 0, 0, -1, huffcodetab.ValTab14, 0);
		huffcodetab.ht[15] = new huffcodetab("15 ", 16, 16, 0, 0, -1, huffcodetab.ValTab15, 511);
		huffcodetab.ht[16] = new huffcodetab("16 ", 16, 16, 1, 1, -1, huffcodetab.ValTab16, 511);
		huffcodetab.ht[17] = new huffcodetab("17 ", 16, 16, 2, 3, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[18] = new huffcodetab("18 ", 16, 16, 3, 7, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[19] = new huffcodetab("19 ", 16, 16, 4, 15, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[20] = new huffcodetab("20 ", 16, 16, 6, 63, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[21] = new huffcodetab("21 ", 16, 16, 8, 255, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[22] = new huffcodetab("22 ", 16, 16, 10, 1023, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[23] = new huffcodetab("23 ", 16, 16, 13, 8191, 16, huffcodetab.ValTab16, 511);
		huffcodetab.ht[24] = new huffcodetab("24 ", 16, 16, 4, 15, -1, huffcodetab.ValTab24, 512);
		huffcodetab.ht[25] = new huffcodetab("25 ", 16, 16, 5, 31, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[26] = new huffcodetab("26 ", 16, 16, 6, 63, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[27] = new huffcodetab("27 ", 16, 16, 7, 127, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[28] = new huffcodetab("28 ", 16, 16, 8, 255, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[29] = new huffcodetab("29 ", 16, 16, 9, 511, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[30] = new huffcodetab("30 ", 16, 16, 11, 2047, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[31] = new huffcodetab("31 ", 16, 16, 13, 8191, 24, huffcodetab.ValTab24, 512);
		huffcodetab.ht[32] = new huffcodetab("32 ", 1, 16, 0, 0, -1, huffcodetab.ValTab32, 31);
		huffcodetab.ht[33] = new huffcodetab("33 ", 1, 16, 0, 0, -1, huffcodetab.ValTab33, 31);
	}
	huffcodetab.huffman_decoder = function(h, x, y, v, w, br) {
		var dmask = 1 << ((4 * 8) - 1);
		var hs = 4 * 8;
		var level;
		var point = 0;
		var error = 1;
		level = dmask;
		if (h.val == null) return 2;
		if (h.treelen == 0) {
			x[0] = y[0] = 0;
			return 0;
		}
		do {
			if (h.val[point][0] == 0) {
				x[0] = h.val[point][1] >>> 4;
				y[0] = h.val[point][1] & 0xf;
				error = 0;
				break;
			}
			if (br.hget1bit() != 0) {
				while (h.val[point][1] >= huffcodetab.MXOFF) point += h.val[point][1];
				point += h.val[point][1];
			} else {
				while (h.val[point][0] >= huffcodetab.MXOFF) point += h.val[point][0];
				point += h.val[point][0];
			}
			level >>>= 1;
		} while ((level != 0) || (point < 0));
		if (h.tablename0 == '3' && (h.tablename1 == '2' || h.tablename1 == '3')) {
			v[0] = (y[0] >> 3) & 1;
			w[0] = (y[0] >> 2) & 1;
			x[0] = (y[0] >> 1) & 1;
			y[0] = y[0] & 1;
			if (v[0] != 0)
				if (br.hget1bit() != 0) v[0] = -v[0];
			if (w[0] != 0)
				if (br.hget1bit() != 0) w[0] = -w[0];
			if (x[0] != 0)
				if (br.hget1bit() != 0) x[0] = -x[0];
			if (y[0] != 0)
				if (br.hget1bit() != 0) y[0] = -y[0];
		} else {
			if (h.linbits != 0)
				if ((h.xlen - 1) == x[0])
					x[0] += br.hgetbits(h.linbits);
			if (x[0] != 0)
				if (br.hget1bit() != 0) x[0] = -x[0];
			if (h.linbits != 0)
				if ((h.ylen - 1) == y[0])
					y[0] += br.hgetbits(h.linbits);
			if (y[0] != 0)
				if (br.hget1bit() != 0) y[0] = -y[0];
		}
		return error;
	}
	const SynthesisFilter = function(channelnumber, factor, eq0) {
		if (SynthesisFilter.d == null) {
			SynthesisFilter.d = SynthesisFilter.load_d();
			SynthesisFilter.d16 = SynthesisFilter.splitArray(SynthesisFilter.d, 16);
		}
		this.v1 = new Float32Array(512);
		this.v2 = new Float32Array(512);
		this._tmpOut = new Float32Array(32);
		this.samples = new Float32Array(32);
		this.channel = channelnumber;
		this.scalefactor = factor;
		this.setEQ(this.eq);
		this.reset();
	}
	SynthesisFilter.d = null;
	SynthesisFilter.d16 = null;
	SynthesisFilter.load_d = function() {
		return new Float32Array([0.000000000, -0.000442505,  0.003250122, -0.007003784, 0.031082153, -0.078628540,  0.100311279, -0.572036743, 1.144989014,  0.572036743,  0.100311279,  0.078628540, 0.031082153,  0.007003784,  0.003250122,  0.000442505, -0.000015259, -0.000473022,  0.003326416, -0.007919312, 0.030517578, -0.084182739,  0.090927124, -0.600219727, 1.144287109,  0.543823242,  0.108856201,  0.073059082, 0.031478882,  0.006118774,  0.003173828,  0.000396729, -0.000015259, -0.000534058,  0.003387451, -0.008865356, 0.029785156, -0.089706421,  0.080688477, -0.628295898, 1.142211914,  0.515609741,  0.116577148,  0.067520142, 0.031738281,  0.005294800,  0.003082275,  0.000366211, -0.000015259, -0.000579834,  0.003433228, -0.009841919, 0.028884888, -0.095169067,  0.069595337, -0.656219482, 1.138763428,  0.487472534,  0.123474121,  0.061996460, 0.031845093,  0.004486084,  0.002990723,  0.000320435, -0.000015259, -0.000625610,  0.003463745, -0.010848999, 0.027801514, -0.100540161,  0.057617188, -0.683914185, 1.133926392,  0.459472656,  0.129577637,  0.056533813, 0.031814575,  0.003723145,  0.002899170,  0.000289917, -0.000015259, -0.000686646,  0.003479004, -0.011886597, 0.026535034, -0.105819702,  0.044784546, -0.711318970, 1.127746582,  0.431655884,  0.134887695,  0.051132202, 0.031661987,  0.003005981,  0.002792358,  0.000259399, -0.000015259, -0.000747681,  0.003479004, -0.012939453, 0.025085449, -0.110946655,  0.031082153, -0.738372803, 1.120223999,  0.404083252,  0.139450073,  0.045837402, 0.031387329,  0.002334595,  0.002685547,  0.000244141, -0.000030518, -0.000808716,  0.003463745, -0.014022827, 0.023422241, -0.115921021,  0.016510010, -0.765029907, 1.111373901,  0.376800537,  0.143264771,  0.040634155, 0.031005859,  0.001693726,  0.002578735,  0.000213623, -0.000030518, -0.000885010,  0.003417969, -0.015121460, 0.021575928, -0.120697021,  0.001068115, -0.791213989, 1.101211548,  0.349868774,  0.146362305,  0.035552979, 0.030532837,  0.001098633,  0.002456665,  0.000198364, -0.000030518, -0.000961304,  0.003372192, -0.016235352, 0.019531250, -0.125259399, -0.015228271, -0.816864014, 1.089782715,  0.323318481,  0.148773193,  0.030609131, 0.029937744,  0.000549316,  0.002349854,  0.000167847, -0.000030518, -0.001037598,  0.003280640, -0.017349243, 0.017257690, -0.129562378, -0.032379150, -0.841949463, 1.077117920,  0.297210693,  0.150497437,  0.025817871, 0.029281616,  0.000030518,  0.002243042,  0.000152588, -0.000045776, -0.001113892,  0.003173828, -0.018463135, 0.014801025, -0.133590698, -0.050354004, -0.866363525, 1.063217163,  0.271591187,  0.151596069,  0.021179199, 0.028533936, -0.000442505,  0.002120972,  0.000137329, -0.000045776, -0.001205444,  0.003051758, -0.019577026, 0.012115479, -0.137298584, -0.069168091, -0.890090942, 1.048156738,  0.246505737,  0.152069092,  0.016708374, 0.027725220, -0.000869751,  0.002014160,  0.000122070, -0.000061035, -0.001296997,  0.002883911, -0.020690918, 0.009231567, -0.140670776, -0.088775635, -0.913055420, 1.031936646,  0.221984863,  0.151962280,  0.012420654, 0.026840210, -0.001266479,  0.001907349,  0.000106812, -0.000061035, -0.001388550,  0.002700806, -0.021789551, 0.006134033, -0.143676758, -0.109161377, -0.935195923, 1.014617920,  0.198059082,  0.151306152,  0.008316040, 0.025909424, -0.001617432,  0.001785278,  0.000106812, -0.000076294, -0.001480103,  0.002487183, -0.022857666, 0.002822876, -0.146255493, -0.130310059, -0.956481934, 0.996246338,  0.174789429,  0.150115967,  0.004394531, 0.024932861, -0.001937866,  0.001693726,  0.000091553, -0.000076294, -0.001586914,  0.002227783, -0.023910522, -0.000686646, -0.148422241, -0.152206421, -0.976852417, 0.976852417,  0.152206421,  0.148422241,  0.000686646, 0.023910522, -0.002227783,  0.001586914,  0.000076294, -0.000091553, -0.001693726,  0.001937866, -0.024932861, -0.004394531, -0.150115967, -0.174789429, -0.996246338, 0.956481934,  0.130310059,  0.146255493, -0.002822876, 0.022857666, -0.002487183,  0.001480103,  0.000076294, -0.000106812, -0.001785278,  0.001617432, -0.025909424, -0.008316040, -0.151306152, -0.198059082, -1.014617920, 0.935195923,  0.109161377,  0.143676758, -0.006134033, 0.021789551, -0.002700806,  0.001388550,  0.000061035, -0.000106812, -0.001907349,  0.001266479, -0.026840210, -0.012420654, -0.151962280, -0.221984863, -1.031936646, 0.913055420,  0.088775635,  0.140670776, -0.009231567, 0.020690918, -0.002883911,  0.001296997,  0.000061035, -0.000122070, -0.002014160,  0.000869751, -0.027725220, -0.016708374, -0.152069092, -0.246505737, -1.048156738, 0.890090942,  0.069168091,  0.137298584, -0.012115479, 0.019577026, -0.003051758,  0.001205444,  0.000045776, -0.000137329, -0.002120972,  0.000442505, -0.028533936, -0.021179199, -0.151596069, -0.271591187, -1.063217163, 0.866363525,  0.050354004,  0.133590698, -0.014801025, 0.018463135, -0.003173828,  0.001113892,  0.000045776, -0.000152588, -0.002243042, -0.000030518, -0.029281616, -0.025817871, -0.150497437, -0.297210693, -1.077117920, 0.841949463,  0.032379150,  0.129562378, -0.017257690, 0.017349243, -0.003280640,  0.001037598,  0.000030518, -0.000167847, -0.002349854, -0.000549316, -0.029937744, -0.030609131, -0.148773193, -0.323318481, -1.089782715, 0.816864014,  0.015228271,  0.125259399, -0.019531250, 0.016235352, -0.003372192,  0.000961304,  0.000030518, -0.000198364, -0.002456665, -0.001098633, -0.030532837, -0.035552979, -0.146362305, -0.349868774, -1.101211548, 0.791213989, -0.001068115,  0.120697021, -0.021575928, 0.015121460, -0.003417969,  0.000885010,  0.000030518, -0.000213623, -0.002578735, -0.001693726, -0.031005859, -0.040634155, -0.143264771, -0.376800537, -1.111373901, 0.765029907, -0.016510010,  0.115921021, -0.023422241, 0.014022827, -0.003463745,  0.000808716,  0.000030518, -0.000244141, -0.002685547, -0.002334595, -0.031387329, -0.045837402, -0.139450073, -0.404083252, -1.120223999, 0.738372803, -0.031082153,  0.110946655, -0.025085449, 0.012939453, -0.003479004,  0.000747681,  0.000015259, -0.000259399, -0.002792358, -0.003005981, -0.031661987, -0.051132202, -0.134887695, -0.431655884, -1.127746582, 0.711318970, -0.044784546,  0.105819702, -0.026535034, 0.011886597, -0.003479004,  0.000686646,  0.000015259, -0.000289917, -0.002899170, -0.003723145, -0.031814575, -0.056533813, -0.129577637, -0.459472656, -1.133926392, 0.683914185, -0.057617188,  0.100540161, -0.027801514, 0.010848999, -0.003463745,  0.000625610,  0.000015259, -0.000320435, -0.002990723, -0.004486084, -0.031845093, -0.061996460, -0.123474121, -0.487472534, -1.138763428, 0.656219482, -0.069595337,  0.095169067, -0.028884888, 0.009841919, -0.003433228,  0.000579834,  0.000015259, -0.000366211, -0.003082275, -0.005294800, -0.031738281, -0.067520142, -0.116577148, -0.515609741, -1.142211914, 0.628295898, -0.080688477,  0.089706421, -0.029785156, 0.008865356, -0.003387451,  0.000534058,  0.000015259, -0.000396729, -0.003173828, -0.006118774, -0.031478882, -0.073059082, -0.108856201, -0.543823242, -1.144287109, 0.600219727, -0.090927124,  0.084182739, -0.030517578, 0.007919312, -0.003326416,  0.000473022,  0.000015259]);
	};
	SynthesisFilter.subArray = function(array, offs, len) {
		if (offs + len > array.length) {
			len = array.length - offs;
		}
		if (len < 0) len = 0;
		var subarray = new Float32Array(len);
		arraycopy(array, offs + 0, subarray, 0, len);
		return subarray;
	}
	SynthesisFilter.splitArray = function(array, blockSize) {
		var size = (array.length / blockSize) | 0;
		var split = new Array(size);
		for (var i = 0; i < size; i++) {
			split[i] = SynthesisFilter.subArray(array, i * blockSize, blockSize);
		}
		return split;
	};
	SynthesisFilter.prototype.setEQ = function(eq0) {
		this.eq = eq0;
		if (this.eq == null) {
			this.eq = new Float32Array(32);
			for (var i = 0; i < 32; i++)
				this.eq[i] = 1;
		}
		if (this.eq.length < 32) {
			throw new Error("IllegalArgumentException(eq0)");
		}
	};
	SynthesisFilter.prototype.reset = function() {
		for (var p = 0; p < 512; p++)
			this.v1[p] = this.v2[p] = 0.0;
		for (var p2 = 0; p2 < 32; p2++)
			this.samples[p2] = 0.0;
		this.actual_v = this.v1;
		this.actual_write_pos = 15;
	};
	SynthesisFilter.prototype.input_sample = function() {
	};
	SynthesisFilter.prototype.input_samples = function(s) {
		for (var i = 31; i >= 0; i--) {
			this.samples[i] = s[i] * this.eq[i];
		}
	};
	SynthesisFilter.prototype.compute_new_v = function() {
		var new_v0, new_v1, new_v2, new_v3, new_v4, new_v5, new_v6, new_v7, new_v8, new_v9;
		var new_v10, new_v11, new_v12, new_v13, new_v14, new_v15, new_v16, new_v17, new_v18, new_v19;
		var new_v20, new_v21, new_v22, new_v23, new_v24, new_v25, new_v26, new_v27, new_v28, new_v29;
		var new_v30, new_v31;
		new_v0 = new_v1 = new_v2 = new_v3 = new_v4 = new_v5 = new_v6 = new_v7 = new_v8 = new_v9 = new_v10 = new_v11 = new_v12 = new_v13 = new_v14 = new_v15 = new_v16 = new_v17 = new_v18 = new_v19 = new_v20 = new_v21 = new_v22 = new_v23 = new_v24 = new_v25 = new_v26 = new_v27 = new_v28 = new_v29 = new_v30 = new_v31 = 0.0;
		var s = this.samples;
		var s0 = s[0];
		var s1 = s[1];
		var s2 = s[2];
		var s3 = s[3];
		var s4 = s[4];
		var s5 = s[5];
		var s6 = s[6];
		var s7 = s[7];
		var s8 = s[8];
		var s9 = s[9];
		var s10 = s[10];
		var s11 = s[11];
		var s12 = s[12];
		var s13 = s[13];
		var s14 = s[14];
		var s15 = s[15];
		var s16 = s[16];
		var s17 = s[17];
		var s18 = s[18];
		var s19 = s[19];
		var s20 = s[20];
		var s21 = s[21];
		var s22 = s[22];
		var s23 = s[23];
		var s24 = s[24];
		var s25 = s[25];
		var s26 = s[26];
		var s27 = s[27];
		var s28 = s[28];
		var s29 = s[29];
		var s30 = s[30];
		var s31 = s[31];
		var p0 = s0 + s31;
		var p1 = s1 + s30;
		var p2 = s2 + s29;
		var p3 = s3 + s28;
		var p4 = s4 + s27;
		var p5 = s5 + s26;
		var p6 = s6 + s25;
		var p7 = s7 + s24;
		var p8 = s8 + s23;
		var p9 = s9 + s22;
		var p10 = s10 + s21;
		var p11 = s11 + s20;
		var p12 = s12 + s19;
		var p13 = s13 + s18;
		var p14 = s14 + s17;
		var p15 = s15 + s16;
		var pp0 = p0 + p15;
		var pp1 = p1 + p14;
		var pp2 = p2 + p13;
		var pp3 = p3 + p12;
		var pp4 = p4 + p11;
		var pp5 = p5 + p10;
		var pp6 = p6 + p9;
		var pp7 = p7 + p8;
		var pp8 = (p0 - p15) * SynthesisFilter.cos1_32;
		var pp9 = (p1 - p14) * SynthesisFilter.cos3_32;
		var pp10 = (p2 - p13) * SynthesisFilter.cos5_32;
		var pp11 = (p3 - p12) * SynthesisFilter.cos7_32;
		var pp12 = (p4 - p11) * SynthesisFilter.cos9_32;
		var pp13 = (p5 - p10) * SynthesisFilter.cos11_32;
		var pp14 = (p6 - p9) * SynthesisFilter.cos13_32;
		var pp15 = (p7 - p8) * SynthesisFilter.cos15_32;
		p0 = pp0 + pp7;
		p1 = pp1 + pp6;
		p2 = pp2 + pp5;
		p3 = pp3 + pp4;
		p4 = (pp0 - pp7) * SynthesisFilter.cos1_16;
		p5 = (pp1 - pp6) * SynthesisFilter.cos3_16;
		p6 = (pp2 - pp5) * SynthesisFilter.cos5_16;
		p7 = (pp3 - pp4) * SynthesisFilter.cos7_16;
		p8 = pp8 + pp15;
		p9 = pp9 + pp14;
		p10 = pp10 + pp13;
		p11 = pp11 + pp12;
		p12 = (pp8 - pp15) * SynthesisFilter.cos1_16;
		p13 = (pp9 - pp14) * SynthesisFilter.cos3_16;
		p14 = (pp10 - pp13) * SynthesisFilter.cos5_16;
		p15 = (pp11 - pp12) * SynthesisFilter.cos7_16;
		pp0 = p0 + p3;
		pp1 = p1 + p2;
		pp2 = (p0 - p3) * SynthesisFilter.cos1_8;
		pp3 = (p1 - p2) * SynthesisFilter.cos3_8;
		pp4 = p4 + p7;
		pp5 = p5 + p6;
		pp6 = (p4 - p7) * SynthesisFilter.cos1_8;
		pp7 = (p5 - p6) * SynthesisFilter.cos3_8;
		pp8 = p8 + p11;
		pp9 = p9 + p10;
		pp10 = (p8 - p11) * SynthesisFilter.cos1_8;
		pp11 = (p9 - p10) * SynthesisFilter.cos3_8;
		pp12 = p12 + p15;
		pp13 = p13 + p14;
		pp14 = (p12 - p15) * SynthesisFilter.cos1_8;
		pp15 = (p13 - p14) * SynthesisFilter.cos3_8;
		p0 = pp0 + pp1;
		p1 = (pp0 - pp1) * SynthesisFilter.cos1_4;
		p2 = pp2 + pp3;
		p3 = (pp2 - pp3) * SynthesisFilter.cos1_4;
		p4 = pp4 + pp5;
		p5 = (pp4 - pp5) * SynthesisFilter.cos1_4;
		p6 = pp6 + pp7;
		p7 = (pp6 - pp7) * SynthesisFilter.cos1_4;
		p8 = pp8 + pp9;
		p9 = (pp8 - pp9) * SynthesisFilter.cos1_4;
		p10 = pp10 + pp11;
		p11 = (pp10 - pp11) * SynthesisFilter.cos1_4;
		p12 = pp12 + pp13;
		p13 = (pp12 - pp13) * SynthesisFilter.cos1_4;
		p14 = pp14 + pp15;
		p15 = (pp14 - pp15) * SynthesisFilter.cos1_4;
		var tmp1;
		new_v19 = -(new_v4 = (new_v12 = p7) + p5) - p6;
		new_v27 = -p6 - p7 - p4;
		new_v6 = (new_v10 = (new_v14 = p15) + p11) + p13;
		new_v17 = -(new_v2 = p15 + p13 + p9) - p14;
		new_v21 = (tmp1 = -p14 - p15 - p10 - p11) - p13;
		new_v29 = -p14 - p15 - p12 - p8;
		new_v25 = tmp1 - p12;
		new_v31 = -p0;
		new_v0 = p1;
		new_v23 = -(new_v8 = p3) - p2;
		p0 = (s0 - s31) * SynthesisFilter.cos1_64;
		p1 = (s1 - s30) * SynthesisFilter.cos3_64;
		p2 = (s2 - s29) * SynthesisFilter.cos5_64;
		p3 = (s3 - s28) * SynthesisFilter.cos7_64;
		p4 = (s4 - s27) * SynthesisFilter.cos9_64;
		p5 = (s5 - s26) * SynthesisFilter.cos11_64;
		p6 = (s6 - s25) * SynthesisFilter.cos13_64;
		p7 = (s7 - s24) * SynthesisFilter.cos15_64;
		p8 = (s8 - s23) * SynthesisFilter.cos17_64;
		p9 = (s9 - s22) * SynthesisFilter.cos19_64;
		p10 = (s10 - s21) * SynthesisFilter.cos21_64;
		p11 = (s11 - s20) * SynthesisFilter.cos23_64;
		p12 = (s12 - s19) * SynthesisFilter.cos25_64;
		p13 = (s13 - s18) * SynthesisFilter.cos27_64;
		p14 = (s14 - s17) * SynthesisFilter.cos29_64;
		p15 = (s15 - s16) * SynthesisFilter.cos31_64;
		pp0 = p0 + p15;
		pp1 = p1 + p14;
		pp2 = p2 + p13;
		pp3 = p3 + p12;
		pp4 = p4 + p11;
		pp5 = p5 + p10;
		pp6 = p6 + p9;
		pp7 = p7 + p8;
		pp8 = (p0 - p15) * SynthesisFilter.cos1_32;
		pp9 = (p1 - p14) * SynthesisFilter.cos3_32;
		pp10 = (p2 - p13) * SynthesisFilter.cos5_32;
		pp11 = (p3 - p12) * SynthesisFilter.cos7_32;
		pp12 = (p4 - p11) * SynthesisFilter.cos9_32;
		pp13 = (p5 - p10) * SynthesisFilter.cos11_32;
		pp14 = (p6 - p9) * SynthesisFilter.cos13_32;
		pp15 = (p7 - p8) * SynthesisFilter.cos15_32;
		p0 = pp0 + pp7;
		p1 = pp1 + pp6;
		p2 = pp2 + pp5;
		p3 = pp3 + pp4;
		p4 = (pp0 - pp7) * SynthesisFilter.cos1_16;
		p5 = (pp1 - pp6) * SynthesisFilter.cos3_16;
		p6 = (pp2 - pp5) * SynthesisFilter.cos5_16;
		p7 = (pp3 - pp4) * SynthesisFilter.cos7_16;
		p8 = pp8 + pp15;
		p9 = pp9 + pp14;
		p10 = pp10 + pp13;
		p11 = pp11 + pp12;
		p12 = (pp8 - pp15) * SynthesisFilter.cos1_16;
		p13 = (pp9 - pp14) * SynthesisFilter.cos3_16;
		p14 = (pp10 - pp13) * SynthesisFilter.cos5_16;
		p15 = (pp11 - pp12) * SynthesisFilter.cos7_16;
		pp0 = p0 + p3;
		pp1 = p1 + p2;
		pp2 = (p0 - p3) * SynthesisFilter.cos1_8;
		pp3 = (p1 - p2) * SynthesisFilter.cos3_8;
		pp4 = p4 + p7;
		pp5 = p5 + p6;
		pp6 = (p4 - p7) * SynthesisFilter.cos1_8;
		pp7 = (p5 - p6) * SynthesisFilter.cos3_8;
		pp8 = p8 + p11;
		pp9 = p9 + p10;
		pp10 = (p8 - p11) * SynthesisFilter.cos1_8;
		pp11 = (p9 - p10) * SynthesisFilter.cos3_8;
		pp12 = p12 + p15;
		pp13 = p13 + p14;
		pp14 = (p12 - p15) * SynthesisFilter.cos1_8;
		pp15 = (p13 - p14) * SynthesisFilter.cos3_8;
		p0 = pp0 + pp1;
		p1 = (pp0 - pp1) * SynthesisFilter.cos1_4;
		p2 = pp2 + pp3;
		p3 = (pp2 - pp3) * SynthesisFilter.cos1_4;
		p4 = pp4 + pp5;
		p5 = (pp4 - pp5) * SynthesisFilter.cos1_4;
		p6 = pp6 + pp7;
		p7 = (pp6 - pp7) * SynthesisFilter.cos1_4;
		p8 = pp8 + pp9;
		p9 = (pp8 - pp9) * SynthesisFilter.cos1_4;
		p10 = pp10 + pp11;
		p11 = (pp10 - pp11) * SynthesisFilter.cos1_4;
		p12 = pp12 + pp13;
		p13 = (pp12 - pp13) * SynthesisFilter.cos1_4;
		p14 = pp14 + pp15;
		p15 = (pp14 - pp15) * SynthesisFilter.cos1_4;
		var tmp2;
		new_v5 = (new_v11 = (new_v13 = (new_v15 = p15) + p7) + p11) + p5 + p13;
		new_v7 = (new_v9 = p15 + p11 + p3) + p13;
		new_v16 = -(new_v1 = (tmp1 = p13 + p15 + p9) + p1) - p14;
		new_v18 = -(new_v3 = tmp1 + p5 + p7) - p6 - p14;
		new_v22 = (tmp1 = -p10 - p11 - p14 - p15) - p13 - p2 - p3;
		new_v20 = tmp1 - p13 - p5 - p6 - p7;
		new_v24 = tmp1 - p12 - p2 - p3;
		new_v26 = tmp1 - p12 - (tmp2 = p4 + p6 + p7);
		new_v30 = (tmp1 = -p8 - p12 - p14 - p15) - p0;
		new_v28 = tmp1 - tmp2;
		var dest = this.actual_v;
		var pos = this.actual_write_pos;
		dest[0 + pos] = new_v0;
		dest[16 + pos] = new_v1;
		dest[32 + pos] = new_v2;
		dest[48 + pos] = new_v3;
		dest[64 + pos] = new_v4;
		dest[80 + pos] = new_v5;
		dest[96 + pos] = new_v6;
		dest[112 + pos] = new_v7;
		dest[128 + pos] = new_v8;
		dest[144 + pos] = new_v9;
		dest[160 + pos] = new_v10;
		dest[176 + pos] = new_v11;
		dest[192 + pos] = new_v12;
		dest[208 + pos] = new_v13;
		dest[224 + pos] = new_v14;
		dest[240 + pos] = new_v15;
		dest[256 + pos] = 0.0;
		dest[272 + pos] = -new_v15;
		dest[288 + pos] = -new_v14;
		dest[304 + pos] = -new_v13;
		dest[320 + pos] = -new_v12;
		dest[336 + pos] = -new_v11;
		dest[352 + pos] = -new_v10;
		dest[368 + pos] = -new_v9;
		dest[384 + pos] = -new_v8;
		dest[400 + pos] = -new_v7;
		dest[416 + pos] = -new_v6;
		dest[432 + pos] = -new_v5;
		dest[448 + pos] = -new_v4;
		dest[464 + pos] = -new_v3;
		dest[480 + pos] = -new_v2;
		dest[496 + pos] = -new_v1;
		dest = (this.actual_v === this.v1) ? this.v2 : this.v1;
		dest[0 + pos] = -new_v0;
		dest[16 + pos] = new_v16;
		dest[32 + pos] = new_v17;
		dest[48 + pos] = new_v18;
		dest[64 + pos] = new_v19;
		dest[80 + pos] = new_v20;
		dest[96 + pos] = new_v21;
		dest[112 + pos] = new_v22;
		dest[128 + pos] = new_v23;
		dest[144 + pos] = new_v24;
		dest[160 + pos] = new_v25;
		dest[176 + pos] = new_v26;
		dest[192 + pos] = new_v27;
		dest[208 + pos] = new_v28;
		dest[224 + pos] = new_v29;
		dest[240 + pos] = new_v30;
		dest[256 + pos] = new_v31;
		dest[272 + pos] = new_v30;
		dest[288 + pos] = new_v29;
		dest[304 + pos] = new_v28;
		dest[320 + pos] = new_v27;
		dest[336 + pos] = new_v26;
		dest[352 + pos] = new_v25;
		dest[368 + pos] = new_v24;
		dest[384 + pos] = new_v23;
		dest[400 + pos] = new_v22;
		dest[416 + pos] = new_v21;
		dest[432 + pos] = new_v20;
		dest[448 + pos] = new_v19;
		dest[464 + pos] = new_v18;
		dest[480 + pos] = new_v17;
		dest[496 + pos] = new_v16;
	};
	SynthesisFilter.prototype.compute_pcm_samples0 = function(buffer) {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var pcm_sample;
			var dp = SynthesisFilter.d16[i];
			pcm_sample = ((vp[0 + dvp] * dp[0]) + (vp[15 + dvp] * dp[1]) + (vp[14 + dvp] * dp[2]) + (vp[13 + dvp] * dp[3]) + (vp[12 + dvp] * dp[4]) + (vp[11 + dvp] * dp[5]) + (vp[10 + dvp] * dp[6]) + (vp[9 + dvp] * dp[7]) + (vp[8 + dvp] * dp[8]) + (vp[7 + dvp] * dp[9]) + (vp[6 + dvp] * dp[10]) + (vp[5 + dvp] * dp[11]) + (vp[4 + dvp] * dp[12]) + (vp[3 + dvp] * dp[13]) + (vp[2 + dvp] * dp[14]) + (vp[1 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples1 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[1 + dvp] * dp[0]) + (vp[0 + dvp] * dp[1]) + (vp[15 + dvp] * dp[2]) + (vp[14 + dvp] * dp[3]) + (vp[13 + dvp] * dp[4]) + (vp[12 + dvp] * dp[5]) + (vp[11 + dvp] * dp[6]) + (vp[10 + dvp] * dp[7]) + (vp[9 + dvp] * dp[8]) + (vp[8 + dvp] * dp[9]) + (vp[7 + dvp] * dp[10]) + (vp[6 + dvp] * dp[11]) + (vp[5 + dvp] * dp[12]) + (vp[4 + dvp] * dp[13]) + (vp[3 + dvp] * dp[14]) + (vp[2 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples2 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[2 + dvp] * dp[0]) + (vp[1 + dvp] * dp[1]) + (vp[0 + dvp] * dp[2]) + (vp[15 + dvp] * dp[3]) + (vp[14 + dvp] * dp[4]) + (vp[13 + dvp] * dp[5]) + (vp[12 + dvp] * dp[6]) + (vp[11 + dvp] * dp[7]) + (vp[10 + dvp] * dp[8]) + (vp[9 + dvp] * dp[9]) + (vp[8 + dvp] * dp[10]) + (vp[7 + dvp] * dp[11]) + (vp[6 + dvp] * dp[12]) + (vp[5 + dvp] * dp[13]) + (vp[4 + dvp] * dp[14]) + (vp[3 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples3 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[3 + dvp] * dp[0]) + (vp[2 + dvp] * dp[1]) + (vp[1 + dvp] * dp[2]) + (vp[0 + dvp] * dp[3]) + (vp[15 + dvp] * dp[4]) + (vp[14 + dvp] * dp[5]) + (vp[13 + dvp] * dp[6]) + (vp[12 + dvp] * dp[7]) + (vp[11 + dvp] * dp[8]) + (vp[10 + dvp] * dp[9]) + (vp[9 + dvp] * dp[10]) + (vp[8 + dvp] * dp[11]) + (vp[7 + dvp] * dp[12]) + (vp[6 + dvp] * dp[13]) + (vp[5 + dvp] * dp[14]) + (vp[4 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples4 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[4 + dvp] * dp[0]) + (vp[3 + dvp] * dp[1]) + (vp[2 + dvp] * dp[2]) + (vp[1 + dvp] * dp[3]) + (vp[0 + dvp] * dp[4]) + (vp[15 + dvp] * dp[5]) + (vp[14 + dvp] * dp[6]) + (vp[13 + dvp] * dp[7]) + (vp[12 + dvp] * dp[8]) + (vp[11 + dvp] * dp[9]) + (vp[10 + dvp] * dp[10]) + (vp[9 + dvp] * dp[11]) + (vp[8 + dvp] * dp[12]) + (vp[7 + dvp] * dp[13]) + (vp[6 + dvp] * dp[14]) + (vp[5 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples5 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[5 + dvp] * dp[0]) + (vp[4 + dvp] * dp[1]) + (vp[3 + dvp] * dp[2]) + (vp[2 + dvp] * dp[3]) + (vp[1 + dvp] * dp[4]) + (vp[0 + dvp] * dp[5]) + (vp[15 + dvp] * dp[6]) + (vp[14 + dvp] * dp[7]) + (vp[13 + dvp] * dp[8]) + (vp[12 + dvp] * dp[9]) + (vp[11 + dvp] * dp[10]) + (vp[10 + dvp] * dp[11]) + (vp[9 + dvp] * dp[12]) + (vp[8 + dvp] * dp[13]) + (vp[7 + dvp] * dp[14]) + (vp[6 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples6 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[6 + dvp] * dp[0]) + (vp[5 + dvp] * dp[1]) + (vp[4 + dvp] * dp[2]) + (vp[3 + dvp] * dp[3]) + (vp[2 + dvp] * dp[4]) + (vp[1 + dvp] * dp[5]) + (vp[0 + dvp] * dp[6]) + (vp[15 + dvp] * dp[7]) + (vp[14 + dvp] * dp[8]) + (vp[13 + dvp] * dp[9]) + (vp[12 + dvp] * dp[10]) + (vp[11 + dvp] * dp[11]) + (vp[10 + dvp] * dp[12]) + (vp[9 + dvp] * dp[13]) + (vp[8 + dvp] * dp[14]) + (vp[7 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples7 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[7 + dvp] * dp[0]) + (vp[6 + dvp] * dp[1]) + (vp[5 + dvp] * dp[2]) + (vp[4 + dvp] * dp[3]) + (vp[3 + dvp] * dp[4]) + (vp[2 + dvp] * dp[5]) + (vp[1 + dvp] * dp[6]) + (vp[0 + dvp] * dp[7]) + (vp[15 + dvp] * dp[8]) + (vp[14 + dvp] * dp[9]) + (vp[13 + dvp] * dp[10]) + (vp[12 + dvp] * dp[11]) + (vp[11 + dvp] * dp[12]) + (vp[10 + dvp] * dp[13]) + (vp[9 + dvp] * dp[14]) + (vp[8 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples8 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[8 + dvp] * dp[0]) + (vp[7 + dvp] * dp[1]) + (vp[6 + dvp] * dp[2]) + (vp[5 + dvp] * dp[3]) + (vp[4 + dvp] * dp[4]) + (vp[3 + dvp] * dp[5]) + (vp[2 + dvp] * dp[6]) + (vp[1 + dvp] * dp[7]) + (vp[0 + dvp] * dp[8]) + (vp[15 + dvp] * dp[9]) + (vp[14 + dvp] * dp[10]) + (vp[13 + dvp] * dp[11]) + (vp[12 + dvp] * dp[12]) + (vp[11 + dvp] * dp[13]) + (vp[10 + dvp] * dp[14]) + (vp[9 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples9 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[9 + dvp] * dp[0]) +(vp[8 + dvp] * dp[1]) +(vp[7 + dvp] * dp[2]) +(vp[6 + dvp] * dp[3]) +(vp[5 + dvp] * dp[4]) +(vp[4 + dvp] * dp[5]) +(vp[3 + dvp] * dp[6]) +(vp[2 + dvp] * dp[7]) +(vp[1 + dvp] * dp[8]) +(vp[0 + dvp] * dp[9]) +(vp[15 + dvp] * dp[10]) +(vp[14 + dvp] * dp[11]) +(vp[13 + dvp] * dp[12]) +(vp[12 + dvp] * dp[13]) +(vp[11 + dvp] * dp[14]) +(vp[10 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples10 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[10 + dvp] * dp[0]) + (vp[9 + dvp] * dp[1]) + (vp[8 + dvp] * dp[2]) + (vp[7 + dvp] * dp[3]) + (vp[6 + dvp] * dp[4]) + (vp[5 + dvp] * dp[5]) + (vp[4 + dvp] * dp[6]) + (vp[3 + dvp] * dp[7]) + (vp[2 + dvp] * dp[8]) + (vp[1 + dvp] * dp[9]) + (vp[0 + dvp] * dp[10]) + (vp[15 + dvp] * dp[11]) + (vp[14 + dvp] * dp[12]) + (vp[13 + dvp] * dp[13]) + (vp[12 + dvp] * dp[14]) + (vp[11 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples11 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[11 + dvp] * dp[0]) + (vp[10 + dvp] * dp[1]) + (vp[9 + dvp] * dp[2]) + (vp[8 + dvp] * dp[3]) + (vp[7 + dvp] * dp[4]) + (vp[6 + dvp] * dp[5]) + (vp[5 + dvp] * dp[6]) + (vp[4 + dvp] * dp[7]) + (vp[3 + dvp] * dp[8]) + (vp[2 + dvp] * dp[9]) + (vp[1 + dvp] * dp[10]) + (vp[0 + dvp] * dp[11]) + (vp[15 + dvp] * dp[12]) + (vp[14 + dvp] * dp[13]) + (vp[13 + dvp] * dp[14]) + (vp[12 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples12 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[12 + dvp] * dp[0]) + (vp[11 + dvp] * dp[1]) + (vp[10 + dvp] * dp[2]) + (vp[9 + dvp] * dp[3]) + (vp[8 + dvp] * dp[4]) + (vp[7 + dvp] * dp[5]) + (vp[6 + dvp] * dp[6]) + (vp[5 + dvp] * dp[7]) + (vp[4 + dvp] * dp[8]) + (vp[3 + dvp] * dp[9]) + (vp[2 + dvp] * dp[10]) + (vp[1 + dvp] * dp[11]) + (vp[0 + dvp] * dp[12]) + (vp[15 + dvp] * dp[13]) + (vp[14 + dvp] * dp[14]) + (vp[13 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples13 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[13 + dvp] * dp[0]) + (vp[12 + dvp] * dp[1]) + (vp[11 + dvp] * dp[2]) + (vp[10 + dvp] * dp[3]) + (vp[9 + dvp] * dp[4]) + (vp[8 + dvp] * dp[5]) + (vp[7 + dvp] * dp[6]) + (vp[6 + dvp] * dp[7]) + (vp[5 + dvp] * dp[8]) + (vp[4 + dvp] * dp[9]) + (vp[3 + dvp] * dp[10]) + (vp[2 + dvp] * dp[11]) + (vp[1 + dvp] * dp[12]) + (vp[0 + dvp] * dp[13]) + (vp[15 + dvp] * dp[14]) + (vp[14 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples14 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var dp = SynthesisFilter.d16[i];
			var pcm_sample;
			pcm_sample = ((vp[14 + dvp] * dp[0]) + (vp[13 + dvp] * dp[1]) + (vp[12 + dvp] * dp[2]) + (vp[11 + dvp] * dp[3]) + (vp[10 + dvp] * dp[4]) + (vp[9 + dvp] * dp[5]) + (vp[8 + dvp] * dp[6]) + (vp[7 + dvp] * dp[7]) + (vp[6 + dvp] * dp[8]) + (vp[5 + dvp] * dp[9]) + (vp[4 + dvp] * dp[10]) + (vp[3 + dvp] * dp[11]) + (vp[2 + dvp] * dp[12]) + (vp[1 + dvp] * dp[13]) + (vp[0 + dvp] * dp[14]) + (vp[15 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples15 = function() {
		var vp = this.actual_v;
		var tmpOut = this._tmpOut;
		var dvp = 0;
		for (var i = 0; i < 32; i++) {
			var pcm_sample;
			var dp = SynthesisFilter.d16[i];
			pcm_sample = ((vp[15 + dvp] * dp[0]) + (vp[14 + dvp] * dp[1]) + (vp[13 + dvp] * dp[2]) + (vp[12 + dvp] * dp[3]) + (vp[11 + dvp] * dp[4]) + (vp[10 + dvp] * dp[5]) + (vp[9 + dvp] * dp[6]) + (vp[8 + dvp] * dp[7]) + (vp[7 + dvp] * dp[8]) + (vp[6 + dvp] * dp[9]) + (vp[5 + dvp] * dp[10]) + (vp[4 + dvp] * dp[11]) + (vp[3 + dvp] * dp[12]) + (vp[2 + dvp] * dp[13]) + (vp[1 + dvp] * dp[14]) + (vp[0 + dvp] * dp[15])) * this.scalefactor;
			tmpOut[i] = pcm_sample;
			dvp += 16;
		}
	};
	SynthesisFilter.prototype.compute_pcm_samples = function(buffer) {
		switch (this.actual_write_pos) {
			case 0:
				this.compute_pcm_samples0(buffer);
				break;
			case 1:
				this.compute_pcm_samples1(buffer);
				break;
			case 2:
				this.compute_pcm_samples2(buffer);
				break;
			case 3:
				this.compute_pcm_samples3(buffer);
				break;
			case 4:
				this.compute_pcm_samples4(buffer);
				break;
			case 5:
				this.compute_pcm_samples5(buffer);
				break;
			case 6:
				this.compute_pcm_samples6(buffer);
				break;
			case 7:
				this.compute_pcm_samples7(buffer);
				break;
			case 8:
				this.compute_pcm_samples8(buffer);
				break;
			case 9:
				this.compute_pcm_samples9(buffer);
				break;
			case 10:
				this.compute_pcm_samples10(buffer);
				break;
			case 11:
				this.compute_pcm_samples11(buffer);
				break;
			case 12:
				this.compute_pcm_samples12(buffer);
				break;
			case 13:
				this.compute_pcm_samples13(buffer);
				break;
			case 14:
				this.compute_pcm_samples14(buffer);
				break;
			case 15:
				this.compute_pcm_samples15(buffer);
				break;
		}
		if (buffer != null) {
			buffer.appendSamples(this.channel, this._tmpOut);
		}
	};
	SynthesisFilter.prototype.calculate_pcm_samples = function(buffer) {
		this.compute_new_v();
		this.compute_pcm_samples(buffer);
		this.actual_write_pos = (this.actual_write_pos + 1) & 0xf;
		this.actual_v = (this.actual_v === this.v1) ? this.v2 : this.v1;
		for (var p = 0; p < 32; p++)
			this.samples[p] = 0.0;
	};
	SynthesisFilter.MY_PI = 3.14159265358979323846;
	SynthesisFilter.cos1_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI / 64.0)));
	SynthesisFilter.cos3_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 3.0 / 64.0)));
	SynthesisFilter.cos5_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 5.0 / 64.0)));
	SynthesisFilter.cos7_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 7.0 / 64.0)));
	SynthesisFilter.cos9_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 9.0 / 64.0)));
	SynthesisFilter.cos11_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 11.0 / 64.0)));
	SynthesisFilter.cos13_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 13.0 / 64.0)));
	SynthesisFilter.cos15_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 15.0 / 64.0)));
	SynthesisFilter.cos17_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 17.0 / 64.0)));
	SynthesisFilter.cos19_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 19.0 / 64.0)));
	SynthesisFilter.cos21_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 21.0 / 64.0)));
	SynthesisFilter.cos23_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 23.0 / 64.0)));
	SynthesisFilter.cos25_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 25.0 / 64.0)));
	SynthesisFilter.cos27_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 27.0 / 64.0)));
	SynthesisFilter.cos29_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 29.0 / 64.0)));
	SynthesisFilter.cos31_64 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 31.0 / 64.0)));
	SynthesisFilter.cos1_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI/ 32.0)));
	SynthesisFilter.cos3_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI* 3.0 / 32.0)));
	SynthesisFilter.cos5_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI* 5.0 / 32.0)));
	SynthesisFilter.cos7_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI* 7.0 / 32.0)));
	SynthesisFilter.cos9_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI* 9.0 / 32.0)));
	SynthesisFilter.cos11_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 11.0 / 32.0)));
	SynthesisFilter.cos13_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 13.0 / 32.0)));
	SynthesisFilter.cos15_32 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 15.0 / 32.0)));
	SynthesisFilter.cos1_16 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI / 16.0)));
	SynthesisFilter.cos3_16 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 3.0 / 16.0)));
	SynthesisFilter.cos5_16 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 5.0 / 16.0)));
	SynthesisFilter.cos7_16 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 7.0 / 16.0)));
	SynthesisFilter.cos1_8 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI / 8.0)));
	SynthesisFilter.cos3_8 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI * 3.0 / 8.0)));
	SynthesisFilter.cos1_4 = (1.0 / (2.0 * Math.cos(SynthesisFilter.MY_PI / 4.0)));
	const gr_info_s = function() {
		this.part2_3_length = 0;
		this.big_values = 0;
		this.global_gain = 0;
		this.scalefac_compress = 0;
		this.window_switching_flag = 0;
		this.block_type = 0;
		this.mixed_block_flag = 0;
		this.table_select = new Int32Array(3);
		this.subblock_gain = new Int32Array(3);
		this.region0_count = 0;
		this.region1_count = 0;
		this.preflag = 0;
		this.scalefac_scale = 0;
		this.count1table_select = 0;
	}
	const temporaire = function() {
		this.scfsi = new Int32Array(4);
		this.gr = [new gr_info_s(), new gr_info_s()];
	}
	const temporaire2 = function() {
		this.l = new Int32Array(23);
		this.s = [new Int32Array(13), new Int32Array(13), new Int32Array(13)];
	}
	const III_side_info_t = function() {
		this.main_data_begin = 0;
		this.private_bits = 0;
		this.ch = [new temporaire(), new temporaire()];
	}
	const SBI = function(thel, thes) {
		this.l = thel;
		this.s = thes;
	}
	const Sftable = function(thel, thes) {
		this.l = thel;
		this.s = thes;
	}
	const MP3Layer3 = function(stream0, header0, filtera, filterb, buffer0, which_ch0) {
		huffcodetab.initHuff();

		this.checkSumHuff = 0;

		this.is_1d = new Int32Array(MP3Layer3.SBLIMIT * MP3Layer3.SSLIMIT + 4);
		this.ro = new Array(2);
		this.lr = new Array(2);
		this.prevblck = new Array(2);
		this.k = new Array(2);
		for (var i = 0; i < 2; i++) {
			this.ro[i] = new Array(MP3Layer3.SBLIMIT);
			this.lr[i] = new Array(MP3Layer3.SBLIMIT);
			this.prevblck[i] = new Float32Array(MP3Layer3.SBLIMIT * MP3Layer3.SSLIMIT);
			this.k[i] = new Float32Array(MP3Layer3.SBLIMIT * MP3Layer3.SSLIMIT);
			for (var j = 0; j < MP3Layer3.SBLIMIT; j++) {
				this.ro[i][j] = new Float32Array(MP3Layer3.SSLIMIT);
				this.lr[i][j] = new Float32Array(MP3Layer3.SSLIMIT);
			}
		}
		this.out_1d = new Float32Array(MP3Layer3.SBLIMIT * MP3Layer3.SSLIMIT);
		this.nonzero = new Int32Array(2);

		this.III_scalefac_t = new Array(2);
		this.III_scalefac_t[0] = new temporaire2();
		this.III_scalefac_t[1] = new temporaire2();
		this.scalefac = this.III_scalefac_t;

		MP3Layer3.sfBandIndex = new Array(9);
		var l0 = [0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576];
		var s0 = [0, 4, 8, 12, 18, 24, 32, 42, 56, 74, 100, 132, 174, 192];
		var l1 = [0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 114, 136, 162, 194, 232, 278, 330, 394, 464, 540, 576];
		var s1 = [0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 136, 180, 192];
		var l2 = [0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576];
		var s2 = [0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192];

		var l3 = [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576];
		var s3 = [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192];
		var l4 = [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576];
		var s4 = [0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192];
		var l5 = [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576];
		var s5 = [0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192];

		var l6 = [0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576];
		var s6 = [0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192];
		var l7 = [0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576];
		var s7 = [0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192];
		var l8 = [0, 12, 24, 36, 48, 60, 72, 88, 108, 132, 160, 192, 232, 280, 336, 400, 476, 566, 568, 570, 572, 574, 576];
		var s8 = [0, 8, 16, 24, 36, 52, 72, 96, 124, 160, 162, 164, 166, 192];

		MP3Layer3.sfBandIndex[0] = new SBI(l0, s0);
		MP3Layer3.sfBandIndex[1] = new SBI(l1, s1);
		MP3Layer3.sfBandIndex[2] = new SBI(l2, s2);

		MP3Layer3.sfBandIndex[3] = new SBI(l3, s3);
		MP3Layer3.sfBandIndex[4] = new SBI(l4, s4);
		MP3Layer3.sfBandIndex[5] = new SBI(l5, s5);
		// SZD: MPEG2.5
		MP3Layer3.sfBandIndex[6] = new SBI(l6, s6);
		MP3Layer3.sfBandIndex[7] = new SBI(l7, s7);
		MP3Layer3.sfBandIndex[8] = new SBI(l8, s8);

		if (MP3Layer3.reorder_table == null) { // SZD: generate LUT
			MP3Layer3.reorder_table = new Array(9);
			for (var i = 0; i < 9; i++)
				MP3Layer3.reorder_table[i] = MP3Layer3.reorder(MP3Layer3.sfBandIndex[i].s);
		}

		var ll0 = [0, 6, 11, 16, 21];
		var ss0 = [0, 6, 12];
		this.sftable = new Sftable(ll0, ss0);

		this.scalefac_buffer = new Int32Array(54);

		this.stream = stream0;
		this.header = header0;
		this.filter1 = filtera;
		this.filter2 = filterb;
		this.buffer = buffer0;
		this.which_channels = which_ch0;

		this.first_channel = 0;
		this.last_channel = 0;

		this.frame_start = 0;
		this.channels = (this.header.mode() == MP3Header.SINGLE_CHANNEL) ? 1 : 2;
		this.max_gr = (this.header.version() == MP3Header.MPEG1) ? 2 : 1;
		this.sfreq = (this.header.sample_frequency() + ((this.header.version() == MP3Header.MPEG1) ? 3 : (this.header.version() == MP3Header.MPEG25_LSF) ? 6 : 0)) | 0;
		
		if (this.channels == 2) {
			this.first_channel = 0;
			this.last_channel = 1;
		} else {
			this.first_channel = this.last_channel = 0;
		}

		this.part2_start = 0;

		for (var ch = 0; ch < 2; ch++)
			for (var j = 0; j < 576; j++)
				this.prevblck[ch][j] = 0.0;

		this.nonzero[0] = this.nonzero[1] = 576;

		this.br = new BitReserve();
		this.si = new III_side_info_t();

		this.samples1 = new Float32Array(32);
		this.samples2 = new Float32Array(32);

		this.new_slen = new Int32Array(4);
	}
	MP3Layer3.reorder_table = null;
	MP3Layer3.reorder = function(scalefac_band) {
		var j = 0;
		var ix = new Int32Array(576);
		for (var sfb = 0; sfb < 13; sfb++) {
			var start = scalefac_band[sfb];
			var end = scalefac_band[sfb + 1];
			for (var _window = 0; _window < 3; _window++)
				for (var i = start; i < end; i++)
					ix[3 * i + _window] = j++;
		}
		return ix;
	}
	MP3Layer3.SSLIMIT = 18;
	MP3Layer3.SBLIMIT = 32;
	MP3Layer3.slen = [
		[0, 0, 0, 0, 3, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4],
		[0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 2, 3],
	];
	MP3Layer3.pretab = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 2, 0];
	MP3Layer3.d43 = 4 / 3;
	MP3Layer3.t_43 = (function() {
		var t43 = new Float32Array(8192);
		var d43 = (4.0 / 3.0);
		for (var i = 0; i < 8192; i++) {
			t43[i] = Math.pow(i, d43);
		}
		return t43;
	}());
	MP3Layer3.prototype.decodeFrame = function() {
		this.decode();
	}
	MP3Layer3.prototype.decode = function() {
		var br = this.br;
		var out_1d = this.out_1d;
		var nSlots = this.header.slots();
		var flush_main = 0;
		var gr = 0, ch = 0, ss = 0, sb = 0, sb18 = 0;
		var main_data_end = 0;
		var bytes_to_discard = 0;
		var i = 0;
		if (this.header.crc() == 0) {
			this.stream.get_bits(16);
		}
		this.get_side_info();
		for (i = 0; i < nSlots; i++) this.br.hputbuf(this.stream.get_bits(8));
		main_data_end = this.br.hsstell() >>> 3;
		if ((flush_main = (this.br.hsstell() & 7)) != 0) {
			this.br.hgetbits(8 - flush_main);
			main_data_end++;
		}
		bytes_to_discard = this.frame_start - main_data_end - this.si.main_data_begin;
		this.frame_start += nSlots;
		if (bytes_to_discard < 0) {
			return;
		}
		if (main_data_end > 4096) {
			this.frame_start -= 4096;
			this.br.rewindNbytes(4096);
		}
		for (; bytes_to_discard > 0; bytes_to_discard--) br.hgetbits(8);
		for (gr = 0; gr < this.max_gr; gr++) {
			for (ch = 0; ch < this.channels; ch++) {
				this.part2_start = br.hsstell();
				if (this.header.version() == MP3Header.MPEG1) this.get_scale_factors(ch, gr);
				else this.get_LSF_scale_factors(ch, gr);
				this.huffman_decode(ch, gr);
				this.dequantize_sample(this.ro[ch], ch, gr);
			}
			this.stereo(gr);
			for (ch = this.first_channel; ch <= this.last_channel; ch++) {
				this.reorder(this.lr[ch], ch, gr);
				this.antialias(ch, gr);
				this.hybrid(ch, gr);
				for (sb18 = 18; sb18 < 576; sb18 += 36)
					for (ss = 1; ss < MP3Layer3.SSLIMIT; ss += 2)
						out_1d[sb18 + ss] = -out_1d[sb18 + ss];
				if (ch == 0) {
					for (ss = 0; ss < MP3Layer3.SSLIMIT; ss++) {
						sb = 0;
						for (sb18 = 0; sb18 < 576; sb18 += 18) {
							this.samples1[sb] = out_1d[sb18 + ss];
							sb++;
						}
						this.filter1.input_samples(this.samples1);
						this.filter1.calculate_pcm_samples(this.buffer);
					}
				} else {
					for (ss = 0; ss < MP3Layer3.SSLIMIT; ss++) {
						sb = 0;
						for (sb18 = 0; sb18 < 576; sb18 += 18) {
							this.samples2[sb] = out_1d[sb18 + ss];
							sb++;
						}
						this.filter2.input_samples(this.samples2);
						this.filter2.calculate_pcm_samples(this.buffer);
					}
				}
			}
		}
	}
	MP3Layer3.prototype.get_side_info = function() {
		var channels = this.channels;
		var si = this.si;
		var stream = this.stream;
		var ch = 0, gr = 0;
		if (this.header.version() == MP3Header.MPEG1) {
			si.main_data_begin = stream.get_bits(9);
			if (channels == 1) si.private_bits = stream.get_bits(5);
			else si.private_bits = stream.get_bits(3);
			for (ch = 0; ch < channels; ch++) {
				si.ch[ch].scfsi[0] = stream.get_bits(1);
				si.ch[ch].scfsi[1] = stream.get_bits(1);
				si.ch[ch].scfsi[2] = stream.get_bits(1);
				si.ch[ch].scfsi[3] = stream.get_bits(1);
			}
			for (gr = 0; gr < 2; gr++) {
				for (ch = 0; ch < channels; ch++) {
					si.ch[ch].gr[gr].part2_3_length = stream.get_bits(12);
					si.ch[ch].gr[gr].big_values = stream.get_bits(9);
					si.ch[ch].gr[gr].global_gain = stream.get_bits(8);
					si.ch[ch].gr[gr].scalefac_compress = stream.get_bits(4);
					si.ch[ch].gr[gr].window_switching_flag = stream.get_bits(1);
					if ((si.ch[ch].gr[gr].window_switching_flag) != 0) {
						si.ch[ch].gr[gr].block_type = stream.get_bits(2);
						si.ch[ch].gr[gr].mixed_block_flag = stream.get_bits(1);
						si.ch[ch].gr[gr].table_select[0] = stream.get_bits(5);
						si.ch[ch].gr[gr].table_select[1] = stream.get_bits(5);
						si.ch[ch].gr[gr].subblock_gain[0] = stream.get_bits(3);
						si.ch[ch].gr[gr].subblock_gain[1] = stream.get_bits(3);
						si.ch[ch].gr[gr].subblock_gain[2] = stream.get_bits(3);
						if (si.ch[ch].gr[gr].block_type == 0) {
							return false;
						} else if (si.ch[ch].gr[gr].block_type == 2 && si.ch[ch].gr[gr].mixed_block_flag == 0) {
							si.ch[ch].gr[gr].region0_count = 8;
						} else {
							si.ch[ch].gr[gr].region0_count = 7;
						}
						si.ch[ch].gr[gr].region1_count = 20 - si.ch[ch].gr[gr].region0_count;
					} else {
						si.ch[ch].gr[gr].table_select[0] = stream.get_bits(5);
						si.ch[ch].gr[gr].table_select[1] = stream.get_bits(5);
						si.ch[ch].gr[gr].table_select[2] = stream.get_bits(5);
						si.ch[ch].gr[gr].region0_count = stream.get_bits(4);
						si.ch[ch].gr[gr].region1_count = stream.get_bits(3);
						si.ch[ch].gr[gr].block_type = 0;
					}
					si.ch[ch].gr[gr].preflag = stream.get_bits(1);
					si.ch[ch].gr[gr].scalefac_scale = stream.get_bits(1);
					si.ch[ch].gr[gr].count1table_select = stream.get_bits(1);
				}
			}
		} else {
			si.main_data_begin = stream.get_bits(8);
			if (channels == 1) si.private_bits = stream.get_bits(1);
			else si.private_bits = stream.get_bits(2);
			for (ch = 0; ch < channels; ch++) {
				si.ch[ch].gr[0].part2_3_length = stream.get_bits(12);
				si.ch[ch].gr[0].big_values = stream.get_bits(9);
				si.ch[ch].gr[0].global_gain = stream.get_bits(8);
				si.ch[ch].gr[0].scalefac_compress = stream.get_bits(9);
				si.ch[ch].gr[0].window_switching_flag = stream.get_bits(1);
				if ((si.ch[ch].gr[0].window_switching_flag) != 0) {
					si.ch[ch].gr[0].block_type = stream.get_bits(2);
					si.ch[ch].gr[0].mixed_block_flag = stream.get_bits(1);
					si.ch[ch].gr[0].table_select[0] = stream.get_bits(5);
					si.ch[ch].gr[0].table_select[1] = stream.get_bits(5);
					si.ch[ch].gr[0].subblock_gain[0] = stream.get_bits(3);
					si.ch[ch].gr[0].subblock_gain[1] = stream.get_bits(3);
					si.ch[ch].gr[0].subblock_gain[2] = stream.get_bits(3);
					if (si.ch[ch].gr[0].block_type == 0) {
						return false;
					} else if (si.ch[ch].gr[0].block_type == 2 && si.ch[ch].gr[0].mixed_block_flag == 0) {
						si.ch[ch].gr[0].region0_count = 8;
					} else {
						si.ch[ch].gr[0].region0_count = 7;
						si.ch[ch].gr[0].region1_count = 20 - si.ch[ch].gr[0].region0_count;
					}
				} else {
					si.ch[ch].gr[0].table_select[0] = stream.get_bits(5);
					si.ch[ch].gr[0].table_select[1] = stream.get_bits(5);
					si.ch[ch].gr[0].table_select[2] = stream.get_bits(5);
					si.ch[ch].gr[0].region0_count = stream.get_bits(4);
					si.ch[ch].gr[0].region1_count = stream.get_bits(3);
					si.ch[ch].gr[0].block_type = 0;
				}
				si.ch[ch].gr[0].scalefac_scale = stream.get_bits(1);
				si.ch[ch].gr[0].count1table_select = stream.get_bits(1);
			}
		}
		return true;
	}
	MP3Layer3.prototype.get_scale_factors = function(ch, gr) {
		var scalefac = this.scalefac;
		var br = this.br;
		var si = this.si;
		var sfb = 0, _window = 0;
		var gr_info = (si.ch[ch].gr[gr]);
		var scale_comp = gr_info.scalefac_compress;
		var length0 = MP3Layer3.slen[0][scale_comp];
		var length1 = MP3Layer3.slen[1][scale_comp];
		if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
			if ((gr_info.mixed_block_flag) != 0) {
				for (sfb = 0; sfb < 8; sfb++)
					this.scalefac[ch].l[sfb] = br.hgetbits(MP3Layer3.slen[0][gr_info.scalefac_compress]);
				for (sfb = 3; sfb < 6; sfb++)
					for (_window = 0; _window < 3; _window++)
						this.scalefac[ch].s[_window][sfb] = br.hgetbits(MP3Layer3.slen[0][gr_info.scalefac_compress]);
				for (sfb = 6; sfb < 12; sfb++)
					for (_window = 0; _window < 3; _window++)
						this.scalefac[ch].s[_window][sfb] = br.hgetbits(MP3Layer3.slen[1][gr_info.scalefac_compress]);
				for (sfb = 12, _window = 0; _window < 3; _window++)
					this.scalefac[ch].s[_window][sfb] = 0;
			} else {
				scalefac[ch].s[0][0] = br.hgetbits(length0);
				scalefac[ch].s[1][0] = br.hgetbits(length0);
				scalefac[ch].s[2][0] = br.hgetbits(length0);
				scalefac[ch].s[0][1] = br.hgetbits(length0);
				scalefac[ch].s[1][1] = br.hgetbits(length0);
				scalefac[ch].s[2][1] = br.hgetbits(length0);
				scalefac[ch].s[0][2] = br.hgetbits(length0);
				scalefac[ch].s[1][2] = br.hgetbits(length0);
				scalefac[ch].s[2][2] = br.hgetbits(length0);
				scalefac[ch].s[0][3] = br.hgetbits(length0);
				scalefac[ch].s[1][3] = br.hgetbits(length0);
				scalefac[ch].s[2][3] = br.hgetbits(length0);
				scalefac[ch].s[0][4] = br.hgetbits(length0);
				scalefac[ch].s[1][4] = br.hgetbits(length0);
				scalefac[ch].s[2][4] = br.hgetbits(length0);
				scalefac[ch].s[0][5] = br.hgetbits(length0);
				scalefac[ch].s[1][5] = br.hgetbits(length0);
				scalefac[ch].s[2][5] = br.hgetbits(length0);
				scalefac[ch].s[0][6] = br.hgetbits(length1);
				scalefac[ch].s[1][6] = br.hgetbits(length1);
				scalefac[ch].s[2][6] = br.hgetbits(length1);
				scalefac[ch].s[0][7] = br.hgetbits(length1);
				scalefac[ch].s[1][7] = br.hgetbits(length1);
				scalefac[ch].s[2][7] = br.hgetbits(length1);
				scalefac[ch].s[0][8] = br.hgetbits(length1);
				scalefac[ch].s[1][8] = br.hgetbits(length1);
				scalefac[ch].s[2][8] = br.hgetbits(length1);
				scalefac[ch].s[0][9] = br.hgetbits(length1);
				scalefac[ch].s[1][9] = br.hgetbits(length1);
				scalefac[ch].s[2][9] = br.hgetbits(length1);
				scalefac[ch].s[0][10] = br.hgetbits(length1);
				scalefac[ch].s[1][10] = br.hgetbits(length1);
				scalefac[ch].s[2][10] = br.hgetbits(length1);
				scalefac[ch].s[0][11] = br.hgetbits(length1);
				scalefac[ch].s[1][11] = br.hgetbits(length1);
				scalefac[ch].s[2][11] = br.hgetbits(length1);
				scalefac[ch].s[0][12] = 0;
				scalefac[ch].s[1][12] = 0;
				scalefac[ch].s[2][12] = 0;
			}
		} else {
			if ((si.ch[ch].scfsi[0] == 0) || (gr == 0)) {
				scalefac[ch].l[0] = br.hgetbits(length0);
				scalefac[ch].l[1] = br.hgetbits(length0);
				scalefac[ch].l[2] = br.hgetbits(length0);
				scalefac[ch].l[3] = br.hgetbits(length0);
				scalefac[ch].l[4] = br.hgetbits(length0);
				scalefac[ch].l[5] = br.hgetbits(length0);
			}
			if ((si.ch[ch].scfsi[1] == 0) || (gr == 0)) {
				scalefac[ch].l[6] = br.hgetbits(length0);
				scalefac[ch].l[7] = br.hgetbits(length0);
				scalefac[ch].l[8] = br.hgetbits(length0);
				scalefac[ch].l[9] = br.hgetbits(length0);
				scalefac[ch].l[10] = br.hgetbits(length0);
			}
			if ((si.ch[ch].scfsi[2] == 0) || (gr == 0)) {
				scalefac[ch].l[11] = br.hgetbits(length1);
				scalefac[ch].l[12] = br.hgetbits(length1);
				scalefac[ch].l[13] = br.hgetbits(length1);
				scalefac[ch].l[14] = br.hgetbits(length1);
				scalefac[ch].l[15] = br.hgetbits(length1);
			}
			if ((si.ch[ch].scfsi[3] == 0) || (gr == 0)) {
				scalefac[ch].l[16] = br.hgetbits(length1);
				scalefac[ch].l[17] = br.hgetbits(length1);
				scalefac[ch].l[18] = br.hgetbits(length1);
				scalefac[ch].l[19] = br.hgetbits(length1);
				scalefac[ch].l[20] = br.hgetbits(length1);
			}
			scalefac[ch].l[21] = 0;
			scalefac[ch].l[22] = 0;
		}
	}
	MP3Layer3.prototype.get_LSF_scale_data = function(ch, gr) {
		var new_slen = this.new_slen;
		var si = this.si;
		var br = this.br;
		var scalefac_comp = 0, int_scalefac_comp = 0;
		var mode_ext = this.header.mode_extension();
		var m;
		var blocktypenumber = 0;
		var blocknumber = 0;
		var gr_info = (si.ch[ch].gr[gr]);
		scalefac_comp = gr_info.scalefac_compress;
		if (gr_info.block_type == 2) {
			if (gr_info.mixed_block_flag == 0)
				blocktypenumber = 1;
			else if (gr_info.mixed_block_flag == 1)
				blocktypenumber = 2;
			else
				blocktypenumber = 0;
		} else {
			blocktypenumber = 0;
		}
		if (!(((mode_ext == 1) || (mode_ext == 3)) && (ch == 1))) {
			if (scalefac_comp < 400) {
				new_slen[0] = (scalefac_comp >>> 4) / 5;
				new_slen[1] = (scalefac_comp >>> 4) % 5;
				new_slen[2] = (scalefac_comp & 0xF) >>> 2;
				new_slen[3] = (scalefac_comp & 3);
				si.ch[ch].gr[gr].preflag = 0;
				blocknumber = 0;
			} else if (scalefac_comp < 500) {
				new_slen[0] = ((scalefac_comp - 400) >>> 2) / 5;
				new_slen[1] = ((scalefac_comp - 400) >>> 2) % 5;
				new_slen[2] = (scalefac_comp - 400) & 3;
				new_slen[3] = 0;
				si.ch[ch].gr[gr].preflag = 0;
				blocknumber = 1;
			} else if (scalefac_comp < 512) {
				new_slen[0] = (scalefac_comp - 500) / 3;
				new_slen[1] = (scalefac_comp - 500) % 3;
				new_slen[2] = 0;
				new_slen[3] = 0;
				si.ch[ch].gr[gr].preflag = 1;
				blocknumber = 2;
			}
		}
		if ((((mode_ext == 1) || (mode_ext == 3)) && (ch == 1))) {
			int_scalefac_comp = scalefac_comp >>> 1;
			if (int_scalefac_comp < 180) {
				new_slen[0] = int_scalefac_comp / 36;
				new_slen[1] = (int_scalefac_comp % 36) / 6;
				new_slen[2] = (int_scalefac_comp % 36) % 6;
				new_slen[3] = 0;
				si.ch[ch].gr[gr].preflag = 0;
				blocknumber = 3;
			} else if (int_scalefac_comp < 244) {
				new_slen[0] = ((int_scalefac_comp - 180) & 0x3F) >>> 4;
				new_slen[1] = ((int_scalefac_comp - 180) & 0xF) >>> 2;
				new_slen[2] = (int_scalefac_comp - 180) & 3;
				new_slen[3] = 0;
				si.ch[ch].gr[gr].preflag = 0;
				blocknumber = 4;
			} else if (int_scalefac_comp < 255) {
				new_slen[0] = (int_scalefac_comp - 244) / 3;
				new_slen[1] = (int_scalefac_comp - 244) % 3;
				new_slen[2] = 0;
				new_slen[3] = 0;
				si.ch[ch].gr[gr].preflag = 0;
				blocknumber = 5;
			}
		}
		for (var x = 0; x < 45; x++)
			this.scalefac_buffer[x] = 0;
		m = 0;
		for (var i = 0; i < 4; i++) {
			for (var j = 0; j < MP3Layer3.nr_of_sfb_block[blocknumber][blocktypenumber][i]; j++) {
				this.scalefac_buffer[m] = (new_slen[i] == 0) ? 0 : br.hgetbits(new_slen[i]);
				m++;
			}
		}
	}
	MP3Layer3.prototype.get_LSF_scale_factors = function(ch, gr) {
		var si = this.si;
		var scalefac = this.scalefac;
		var m = 0;
		var sfb = 0, _window = 0;
		var gr_info = (si.ch[ch].gr[gr]);
		this.get_LSF_scale_data(ch, gr);
		if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
			if (gr_info.mixed_block_flag != 0) { // MIXED
				for (sfb = 0; sfb < 8; sfb++) {
					scalefac[ch].l[sfb] = this.scalefac_buffer[m];
					m++;
				}
				for (sfb = 3; sfb < 12; sfb++) {
					for (_window = 0; _window < 3; _window++) {
						scalefac[ch].s[_window][sfb] = this.scalefac_buffer[m];
						m++;
					}
				}
				for (_window = 0; _window < 3; _window++)
					scalefac[ch].s[_window][12] = 0;

			} else { // SHORT
				for (sfb = 0; sfb < 12; sfb++) {
					for (_window = 0; _window < 3; _window++) {
						scalefac[ch].s[_window][sfb] = this.scalefac_buffer[m];
						m++;
					}
				}
				for (_window = 0; _window < 3; _window++)
					scalefac[ch].s[_window][12] = 0;
			}
		} else { // LONG types 0,1,3
			for (sfb = 0; sfb < 21; sfb++) {
				scalefac[ch].l[sfb] = this.scalefac_buffer[m];
				m++;
			}
			scalefac[ch].l[21] = 0; // Jeff
			scalefac[ch].l[22] = 0;
		}
	}
	var x = new Int32Array(1);
	var y = new Int32Array(1);
	var v = new Int32Array(1);
	var w = new Int32Array(1);
	MP3Layer3.prototype.huffman_decode = function(ch, gr) {
		var br = this.br;
		var si = this.si;
		var is_1d = this.is_1d;
		var sfreq = this.sfreq;
		x[0] = 0;
		y[0] = 0;
		v[0] = 0;
		w[0] = 0;
		var part2_3_end = this.part2_start + si.ch[ch].gr[gr].part2_3_length;
		var num_bits = 0;
		var region1Start = 0;
		var region2Start = 0;
		var index = 0;
		var buf = 0, buf1 = 0;
		var h = null;
		if (((si.ch[ch].gr[gr].window_switching_flag) != 0) && (si.ch[ch].gr[gr].block_type == 2)) {
			region1Start = (sfreq == 8) ? 72 : 36;
			region2Start = 576;
		} else {
			buf = si.ch[ch].gr[gr].region0_count + 1;
			buf1 = buf + si.ch[ch].gr[gr].region1_count + 1;
			if (buf1 > MP3Layer3.sfBandIndex[sfreq].l.length - 1) {
				buf1 = MP3Layer3.sfBandIndex[sfreq].l.length - 1;
			}
			region1Start = MP3Layer3.sfBandIndex[sfreq].l[buf];
			region2Start = MP3Layer3.sfBandIndex[sfreq].l[buf1];
		}
		index = 0;
		for (var i = 0; i < (si.ch[ch].gr[gr].big_values << 1); i += 2) {
			if (i < region1Start) h = huffcodetab.ht[si.ch[ch].gr[gr].table_select[0]];
			else if (i < region2Start) h = huffcodetab.ht[si.ch[ch].gr[gr].table_select[1]];
			else h = huffcodetab.ht[si.ch[ch].gr[gr].table_select[2]];
			huffcodetab.huffman_decoder(h, x, y, v, w, br);
			is_1d[index++] = x[0];
			is_1d[index++] = y[0];
			this.checkSumHuff = this.checkSumHuff + x[0] + y[0];
		}
		h = huffcodetab.ht[si.ch[ch].gr[gr].count1table_select + 32];
		num_bits = br.hsstell();
		while ((num_bits < part2_3_end) && (index < 576)) {
			huffcodetab.huffman_decoder(h, x, y, v, w, br);
			is_1d[index++] = v[0];
			is_1d[index++] = w[0];
			is_1d[index++] = x[0];
			is_1d[index++] = y[0];
			this.checkSumHuff = this.checkSumHuff + v[0] + w[0] + x[0] + y[0];
			num_bits = br.hsstell();
		}
		if (num_bits > part2_3_end) {
			br.rewindNbits(num_bits - part2_3_end);
			index -= 4;
		}
		num_bits = br.hsstell();
		if (num_bits < part2_3_end)
			br.hgetbits(part2_3_end - num_bits);
		this.nonzero[ch] = Math.min(index, 576);
		if (index < 0) index = 0;
		for (; index < 576; index++)
			is_1d[index] = 0;
	}
	MP3Layer3.prototype.dequantize_sample = function(xr, ch, gr) {
		var scalefac = this.scalefac;
		var sfreq = this.sfreq;
		var is_1d = this.is_1d;
		var si = this.si;
		var gr_info = (si.ch[ch].gr[gr]);
		var cb = 0;
		var next_cb_boundary = 0;
		var cb_begin = 0;
		var cb_width = 0;
		var index = 0, t_index = 0, j = 0;
		var g_gain = 0;
		var xr_1d = xr;
		if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
			if (gr_info.mixed_block_flag != 0)
				next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].l[1];
			else {
				cb_width = MP3Layer3.sfBandIndex[sfreq].s[1];
				next_cb_boundary = (cb_width << 2) - cb_width;
				cb_begin = 0;
			}
		} else {
			next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].l[1];
		}
		g_gain = Math.pow(2.0, (0.25 * (gr_info.global_gain - 210.0)));
		for (j = 0; j < this.nonzero[ch]; j++) {
			var reste = j % MP3Layer3.SSLIMIT;
			var quotien = ((j - reste) / MP3Layer3.SSLIMIT) | 0;
			if (is_1d[j] == 0) xr_1d[quotien][reste] = 0.0;
			else {
				var abv = is_1d[j];
				if (abv < MP3Layer3.t_43.length) {
					if (is_1d[j] > 0) xr_1d[quotien][reste] = g_gain * MP3Layer3.t_43[abv];
					else {
						if (-abv < MP3Layer3.t_43.length) xr_1d[quotien][reste] = -g_gain * MP3Layer3.t_43[-abv];
						else xr_1d[quotien][reste] = -g_gain * Math.pow(-abv, MP3Layer3.d43);
					}
				} else {
					if (is_1d[j] > 0) xr_1d[quotien][reste] = g_gain * Math.pow(abv, MP3Layer3.d43);
					else xr_1d[quotien][reste] = -g_gain * Math.pow(-abv, MP3Layer3.d43);
				}
			}
		}
		for (j = 0; j < this.nonzero[ch]; j++) {
			var reste = j % MP3Layer3.SSLIMIT;
			var quotien = ((j - reste) / MP3Layer3.SSLIMIT) | 0;
			if (index == next_cb_boundary) {
				if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
					if (gr_info.mixed_block_flag != 0) {
						if (index == MP3Layer3.sfBandIndex[sfreq].l[8]) {
							next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].s[4];
							next_cb_boundary = (next_cb_boundary << 2) - next_cb_boundary;
							cb = 3;
							cb_width = MP3Layer3.sfBandIndex[sfreq].s[4] - MP3Layer3.sfBandIndex[sfreq].s[3];
							cb_begin = MP3Layer3.sfBandIndex[sfreq].s[3];
							cb_begin = (cb_begin << 2) - cb_begin;
						} else if (index < MP3Layer3.sfBandIndex[sfreq].l[8]) {
							next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].l[(++cb) + 1];
						} else {
							next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].s[(++cb) + 1];
							next_cb_boundary = (next_cb_boundary << 2) - next_cb_boundary;
							cb_begin = MP3Layer3.sfBandIndex[sfreq].s[cb];
							cb_width = MP3Layer3.sfBandIndex[sfreq].s[cb + 1] - cb_begin;
							cb_begin = (cb_begin << 2) - cb_begin;
						}
					} else {
						next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].s[(++cb) + 1];
						next_cb_boundary = (next_cb_boundary << 2) - next_cb_boundary;
						cb_begin = MP3Layer3.sfBandIndex[sfreq].s[cb];
						cb_width = MP3Layer3.sfBandIndex[sfreq].s[cb + 1] - cb_begin;
						cb_begin = (cb_begin << 2) - cb_begin;
					}
				} else {
					next_cb_boundary = MP3Layer3.sfBandIndex[sfreq].l[(++cb) + 1];
				}
			}
			if ((gr_info.window_switching_flag != 0) && (((gr_info.block_type == 2) && (gr_info.mixed_block_flag == 0)) || ((gr_info.block_type == 2) && (gr_info.mixed_block_flag != 0) && (j >= 36)))) {
				t_index = ((index - cb_begin) / cb_width) | 0;
				var idx = scalefac[ch].s[t_index][cb] << gr_info.scalefac_scale;
				idx += (gr_info.subblock_gain[t_index] << 2);
				xr_1d[quotien][reste] *= MP3Layer3.two_to_negative_half_pow[idx];
			} else {
				var idx = scalefac[ch].l[cb];
				if (gr_info.preflag != 0) idx += MP3Layer3.pretab[cb];
				idx = idx << gr_info.scalefac_scale;
				xr_1d[quotien][reste] *= MP3Layer3.two_to_negative_half_pow[idx];
			}
			index++;
		}
		for (j = this.nonzero[ch]; j < 576; j++) {
			var reste = j % MP3Layer3.SSLIMIT;
			var quotien = ((j - reste) / MP3Layer3.SSLIMIT) | 0;
			if (reste < 0) reste = 0;
			if (quotien < 0) quotien = 0;
			xr_1d[quotien][reste] = 0.0;
		}
	}
	MP3Layer3.nr_of_sfb_block = [
		[[6, 5, 5, 5], [9, 9, 9, 9], [6, 9, 9, 9]],
		[[6, 5, 7, 3], [9, 9, 12, 6], [6, 9, 12, 6]],
		[[11, 10, 0, 0], [18, 18, 0, 0], [15, 18, 0, 0]],
		[[7, 7, 7, 0], [12, 12, 12, 0], [6, 15, 12, 0]],
		[[6, 6, 6, 3], [12, 9, 9, 6], [6, 12, 9, 6]],
		[[8, 8, 5, 0], [15, 12, 9, 0], [6, 18, 9, 0]]
	];
	var is_pos = new Int32Array(576);
	var is_ratio = new Float32Array(576);
	MP3Layer3.io = [[1.0000000000E+00, 8.4089641526E-01, 7.0710678119E-01, 5.9460355751E-01, 5.0000000001E-01, 4.2044820763E-01, 3.5355339060E-01, 2.9730177876E-01, 2.5000000001E-01, 2.1022410382E-01, 1.7677669530E-01, 1.4865088938E-01, 1.2500000000E-01, 1.0511205191E-01, 8.8388347652E-02, 7.4325444691E-02, 6.2500000003E-02, 5.2556025956E-02, 4.4194173826E-02, 3.7162722346E-02, 3.1250000002E-02, 2.6278012978E-02, 2.2097086913E-02, 1.8581361173E-02, 1.5625000001E-02, 1.3139006489E-02, 1.1048543457E-02, 9.2906805866E-03, 7.8125000006E-03, 6.5695032447E-03, 5.5242717285E-03, 4.6453402934E-03], [1.0000000000E+00, 7.0710678119E-01, 5.0000000000E-01, 3.5355339060E-01, 2.5000000000E-01, 1.7677669530E-01, 1.2500000000E-01, 8.8388347650E-02, 6.2500000001E-02, 4.4194173825E-02, 3.1250000001E-02, 2.2097086913E-02, 1.5625000000E-02, 1.1048543456E-02, 7.8125000002E-03, 5.5242717282E-03, 3.9062500001E-03, 2.7621358641E-03, 1.9531250001E-03, 1.3810679321E-03, 9.7656250004E-04, 6.9053396603E-04, 4.8828125002E-04, 3.4526698302E-04, 2.4414062501E-04, 1.7263349151E-04, 1.2207031251E-04, 8.6316745755E-05, 6.1035156254E-05, 4.3158372878E-05, 3.0517578127E-05, 2.1579186439E-05]]
	MP3Layer3.TAN12 = new Float32Array([0.0, 0.26794919, 0.57735027, 1.0, 1.73205081, 3.73205081, 9.9999999e10, -3.73205081, -1.73205081, -1.0, -0.57735027, -0.26794919, 0.0, 0.26794919, 0.57735027, 1.0]);
	MP3Layer3.cs = new Float32Array([0.857492925712, 0.881741997318, 0.949628649103, 0.983314592492, 0.995517816065, 0.999160558175, 0.999899195243, 0.999993155067]);
	MP3Layer3.ca = new Float32Array([-0.5144957554270, -0.4717319685650, -0.3133774542040, -0.1819131996110, -0.0945741925262, -0.0409655828852, -0.0141985685725, -0.00369997467375]);
	MP3Layer3.two_to_negative_half_pow = new Float32Array([1.0000000000E+00, 7.0710678119E-01, 5.0000000000E-01, 3.5355339059E-01, 2.5000000000E-01, 1.7677669530E-01, 1.2500000000E-01, 8.8388347648E-02, 6.2500000000E-02, 4.4194173824E-02, 3.1250000000E-02, 2.2097086912E-02, 1.5625000000E-02, 1.1048543456E-02, 7.8125000000E-03, 5.5242717280E-03, 3.9062500000E-03, 2.7621358640E-03, 1.9531250000E-03, 1.3810679320E-03, 9.7656250000E-04, 6.9053396600E-04, 4.8828125000E-04, 3.4526698300E-04, 2.4414062500E-04, 1.7263349150E-04, 1.2207031250E-04, 8.6316745750E-05, 6.1035156250E-05, 4.3158372875E-05, 3.0517578125E-05, 2.1579186438E-05, 1.5258789062E-05, 1.0789593219E-05, 7.6293945312E-06, 5.3947966094E-06, 3.8146972656E-06, 2.6973983047E-06, 1.9073486328E-06, 1.3486991523E-06, 9.5367431641E-07, 6.7434957617E-07, 4.7683715820E-07, 3.3717478809E-07, 2.3841857910E-07, 1.6858739404E-07, 1.1920928955E-07, 8.4293697022E-08, 5.9604644775E-08, 4.2146848511E-08, 2.9802322388E-08, 2.1073424255E-08, 1.4901161194E-08, 1.0536712128E-08, 7.4505805969E-09, 5.2683560639E-09, 3.7252902985E-09, 2.6341780319E-09, 1.8626451492E-09, 1.3170890160E-09, 9.3132257462E-10, 6.5854450798E-10, 4.6566128731E-10, 3.2927225399E-10]);
	MP3Layer3.prototype.i_stereo_k_values = function(is_pos, io_type, i) {
		var k = this.k;
		if (is_pos == 0) {
			k[0][i] = 1.0;
			k[1][i] = 1.0;
		} else if ((is_pos & 1) != 0) {
			k[0][i] = MP3Layer3.io[io_type][(is_pos + 1) >>> 1];
			k[1][i] = 1.0;
		} else {
			k[0][i] = 1.0;
			k[1][i] = MP3Layer3.io[io_type][is_pos >>> 1];
		}
	}
	MP3Layer3.prototype.stereo = function(gr) {
		var sfreq = this.sfreq;
		var scalefac = this.scalefac;
		var ro = this.ro;
		var lr = this.lr;
		var si = this.si;
		var k = this.k;
		var sb = 0, ss = 0;
		if (this.channels == 1) {
			for (sb = 0; sb < MP3Layer3.SBLIMIT; sb++)
				for (ss = 0; ss < MP3Layer3.SSLIMIT; ss += 3) {
					lr[0][sb][ss] = ro[0][sb][ss];
					lr[0][sb][ss + 1] = ro[0][sb][ss + 1];
					lr[0][sb][ss + 2] = ro[0][sb][ss + 2];
				}
		} else {
			var gr_info = (si.ch[0].gr[gr]);
			var mode_ext = this.header.mode_extension();
			var sfb = 0;
			var i = 0;
			var lines = 0, temp = 0, temp2 = 0;
			var ms_stereo = ((this.header.mode() == MP3Header.JOINT_STEREO) && ((mode_ext & 0x2) != 0));
			var i_stereo = ((this.header.mode() == MP3Header.JOINT_STEREO) && ((mode_ext & 0x1) != 0));
			var lsf = ((this.header.version() == MP3Header.MPEG2_LSF || this.header.version() == MP3Header.MPEG25_LSF));
			var io_type = (gr_info.scalefac_compress & 1);
			for (i = 0; i < 576; i++) {
				is_pos[i] = 7;
				is_ratio[i] = 0.0;
			}
			if (i_stereo) {
				if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
					if (gr_info.mixed_block_flag != 0) {
						var max_sfb = 0;
						for (var j = 0; j < 3; j++) {
							var sfbcnt = 0;
							sfbcnt = 2;
							for (sfb = 12; sfb >= 3; sfb--) {
								i = MP3Layer3.sfBandIndex[sfreq].s[sfb];
								lines = MP3Layer3.sfBandIndex[sfreq].s[sfb + 1] - i;
								i = (i << 2) - i + (j + 1) * lines - 1;
								while (lines > 0) {
									if (ro[1][(i / 18) | 0][i % 18] != 0.0) {
										sfbcnt = sfb;
										sfb = -10;
										lines = -10;
									}
									lines--;
									i--;
								}
							}
							sfb = sfbcnt + 1;
							if (sfb > max_sfb)
								max_sfb = sfb;
							while (sfb < 12) {
								temp = MP3Layer3.sfBandIndex[sfreq].s[sfb];
								sb = MP3Layer3.sfBandIndex[sfreq].s[sfb + 1] - temp;
								i = (temp << 2) - temp + j * sb;
								for (; sb > 0; sb--) {
									is_pos[i] = scalefac[1].s[j][sfb];
									if (is_pos[i] != 7)
										if (lsf)
											this.i_stereo_k_values(is_pos[i], io_type, i);
										else
											is_ratio[i] = MP3Layer3.TAN12[is_pos[i]];
									i++;
								}
								sfb++;
							}
							sfb = MP3Layer3.sfBandIndex[sfreq].s[10];
							sb = MP3Layer3.sfBandIndex[sfreq].s[11] - sfb;
							sfb = (sfb << 2) - sfb + j * sb;
							temp = MP3Layer3.sfBandIndex[sfreq].s[11];
							sb = MP3Layer3.sfBandIndex[sfreq].s[12] - temp;
							i = (temp << 2) - temp + j * sb;
							for (; sb > 0; sb--) {
								is_pos[i] = is_pos[sfb];
								if (lsf) {
									k[0][i] = k[0][sfb];
									k[1][i] = k[1][sfb];
								} else {
									is_ratio[i] = is_ratio[sfb];
								}
								i++;
							}
						}
						if (max_sfb <= 3) {
							i = 2;
							ss = 17;
							sb = -1;
							while (i >= 0) {
								if (ro[1][i][ss] != 0.0) {
									sb = (i << 4) + (i << 1) + ss;
									i = -1;
								} else {
									ss--;
									if (ss < 0) {
										i--;
										ss = 17;
									}
								}
							}
							i = 0;
							while (MP3Layer3.sfBandIndex[sfreq].l[i] <= sb)
								i++;
							sfb = i;
							i = MP3Layer3.sfBandIndex[sfreq].l[i];
							for (; sfb < 8; sfb++) {
								sb = MP3Layer3.sfBandIndex[sfreq].l[sfb + 1] - MP3Layer3.sfBandIndex[sfreq].l[sfb];
								for (; sb > 0; sb--) {
									is_pos[i] = scalefac[1].l[sfb];
									if (is_pos[i] != 7)
										if (lsf)
											this.i_stereo_k_values(is_pos[i], io_type, i);
										else
											is_ratio[i] = MP3Layer3.TAN12[is_pos[i]];
									i++;
								}
							}
						}
					} else {
						for (var j = 0; j < 3; j++) {
							var sfbcnt = 0;
							sfbcnt = -1;
							for (sfb = 12; sfb >= 0; sfb--) {
								temp = MP3Layer3.sfBandIndex[sfreq].s[sfb];
								lines = MP3Layer3.sfBandIndex[sfreq].s[sfb + 1] - temp;
								i = (temp << 2) - temp + (j + 1) * lines - 1;
								while (lines > 0) {
									if (ro[1][(i / 18) | 0][i % 18] != 0.0) {
										sfbcnt = sfb;
										sfb = -10;
										lines = -10;
									}
									lines--;
									i--;
								}
							}
							sfb = sfbcnt + 1;
							while (sfb < 12) {
								temp = MP3Layer3.sfBandIndex[sfreq].s[sfb];
								sb = MP3Layer3.sfBandIndex[sfreq].s[sfb + 1] - temp;
								i = (temp << 2) - temp + j * sb;
								for (; sb > 0; sb--) {
									is_pos[i] = scalefac[1].s[j][sfb];
									if (is_pos[i] != 7)
										if (lsf)
											this.i_stereo_k_values(is_pos[i], io_type, i);
										else
											is_ratio[i] = MP3Layer3.TAN12[is_pos[i]];
									i++;
								}
								sfb++;
							}
							temp = MP3Layer3.sfBandIndex[sfreq].s[10];
							temp2 = MP3Layer3.sfBandIndex[sfreq].s[11];
							sb = temp2 - temp;
							sfb = (temp << 2) - temp + j * sb;
							sb = MP3Layer3.sfBandIndex[sfreq].s[12] - temp2;
							i = (temp2 << 2) - temp2 + j * sb;
							for (; sb > 0; sb--) {
								is_pos[i] = is_pos[sfb];
								if (lsf) {
									k[0][i] = k[0][sfb];
									k[1][i] = k[1][sfb];
								} else {
									is_ratio[i] = is_ratio[sfb];
								}
								i++;
							}
						}
					}
				} else {
					i = 31;
					ss = 17;
					sb = 0;
					while (i >= 0) {
						if (ro[1][i][ss] != 0.0) {
							sb = (i << 4) + (i << 1) + ss;
							i = -1;
						} else {
							ss--;
							if (ss < 0) {
								i--;
								ss = 17;
							}
						}
					}
					i = 0;
					while (MP3Layer3.sfBandIndex[sfreq].l[i] <= sb)
						i++;
					sfb = i;
					i = MP3Layer3.sfBandIndex[sfreq].l[i];
					for (; sfb < 21; sfb++) {
						sb = MP3Layer3.sfBandIndex[sfreq].l[sfb + 1] - MP3Layer3.sfBandIndex[sfreq].l[sfb];
						for (; sb > 0; sb--) {
							is_pos[i] = scalefac[1].l[sfb];
							if (is_pos[i] != 7)
								if (lsf)
									this.i_stereo_k_values(is_pos[i], io_type, i);
								else
									is_ratio[i] = MP3Layer3.TAN12[is_pos[i]];
							i++;
						}
					}
					sfb = MP3Layer3.sfBandIndex[sfreq].l[20];
					for (sb = 576 - MP3Layer3.sfBandIndex[sfreq].l[21]; (sb > 0) && (i < 576); sb--) {
						is_pos[i] = is_pos[sfb];
						if (lsf) {
							k[0][i] = k[0][sfb];
							k[1][i] = k[1][sfb];
						} else {
							is_ratio[i] = is_ratio[sfb];
						}
						i++;
					}
				}
			}
			i = 0;
			for (sb = 0; sb < MP3Layer3.SBLIMIT; sb++)
				for (ss = 0; ss < MP3Layer3.SSLIMIT; ss++) {
					if (is_pos[i] == 7) {
						if (ms_stereo) {
							lr[0][sb][ss] = (ro[0][sb][ss] + ro[1][sb][ss]) * 0.707106781;
							lr[1][sb][ss] = (ro[0][sb][ss] - ro[1][sb][ss]) * 0.707106781;
						} else {
							lr[0][sb][ss] = ro[0][sb][ss];
							lr[1][sb][ss] = ro[1][sb][ss];
						}
					} else if (i_stereo) {
						if (lsf) {
							lr[0][sb][ss] = ro[0][sb][ss] * k[0][i];
							lr[1][sb][ss] = ro[0][sb][ss] * k[1][i];
						} else {
							lr[1][sb][ss] = ro[0][sb][ss] / (1 + is_ratio[i]);
							lr[0][sb][ss] = lr[1][sb][ss] * is_ratio[i];
						}
					}
					i++;
				}
		}
	}
	MP3Layer3.prototype.do_downmix = function() {
		var lr = this.lr;
		for (var sb = 0; sb < MP3Layer3.SSLIMIT; sb++) {
			for (var ss = 0; ss < MP3Layer3.SSLIMIT; ss += 3) {
				lr[0][sb][ss] = (lr[0][sb][ss] + lr[1][sb][ss]) * 0.5;
				lr[0][sb][ss + 1] = (lr[0][sb][ss + 1] + lr[1][sb][ss + 1]) * 0.5;
				lr[0][sb][ss + 2] = (lr[0][sb][ss + 2] + lr[1][sb][ss + 2]) * 0.5;
			}
		}
	}
	MP3Layer3.prototype.reorder = function(xr, ch, gr) {
		var sfreq = this.sfreq;
		var si = this.si;
		var out_1d = this.out_1d;
		var gr_info = (si.ch[ch].gr[gr]);
		var freq = 0, freq3 = 0;
		var index = 0;
		var sfb = 0, sfb_start = 0, sfb_lines = 0;
		var src_line = 0, des_line = 0;
		var xr_1d = xr;
		if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2)) {
			for (index = 0; index < 576; index++)
				out_1d[index] = 0.0;
			if (gr_info.mixed_block_flag != 0) {
				for (index = 0; index < 36; index++) {
					var reste = index % MP3Layer3.SSLIMIT;
					var quotien = ((index - reste) / MP3Layer3.SSLIMIT) | 0;
					out_1d[index] = xr_1d[quotien][reste];
				}
				for (sfb = 3; sfb < 13; sfb++) {
					sfb_start = MP3Layer3.sfBandIndex[sfreq].s[sfb];
					sfb_lines = MP3Layer3.sfBandIndex[sfreq].s[sfb + 1] - sfb_start;
					var sfb_start3 = (sfb_start << 2) - sfb_start;
					for (freq = 0, freq3 = 0; freq < sfb_lines; freq++, freq3 += 3) {
						src_line = sfb_start3 + freq;
						des_line = sfb_start3 + freq3;
						var reste = src_line % MP3Layer3.SSLIMIT;
						var quotien = ((src_line - reste) / MP3Layer3.SSLIMIT) | 0;
						out_1d[des_line] = xr_1d[quotien][reste];
						src_line += sfb_lines;
						des_line++;
						reste = src_line % MP3Layer3.SSLIMIT;
						quotien = ((src_line - reste) / MP3Layer3.SSLIMIT) | 0;
						out_1d[des_line] = xr_1d[quotien][reste];
						src_line += sfb_lines;
						des_line++;
						reste = src_line % MP3Layer3.SSLIMIT;
						quotien = ((src_line - reste) / MP3Layer3.SSLIMIT) | 0;
						out_1d[des_line] = xr_1d[quotien][reste];
					}
				}
			} else {
				for (index = 0; index < 576; index++) {
					var j = MP3Layer3.reorder_table[sfreq][index];
					var reste = j % MP3Layer3.SSLIMIT;
					var quotien = ((j - reste) / MP3Layer3.SSLIMIT) | 0;
					out_1d[index] = xr_1d[quotien][reste];
				}
			}
		} else {
			for (index = 0; index < 576; index++) {
				var reste = index % MP3Layer3.SSLIMIT;
				var quotien = ((index - reste) / MP3Layer3.SSLIMIT) | 0;
				out_1d[index] = xr_1d[quotien][reste];
			}
		}
	}
	MP3Layer3.prototype.antialias = function(ch, gr) {
		var si = this.si;
		var out_1d = this.out_1d;
		var sb18 = 0, ss = 0, sb18lim = 0;
		var gr_info = (si.ch[ch].gr[gr]);
		if ((gr_info.window_switching_flag != 0) && (gr_info.block_type == 2) && !(gr_info.mixed_block_flag != 0))
			return;
		if ((gr_info.window_switching_flag != 0) && (gr_info.mixed_block_flag != 0) && (gr_info.block_type == 2)) {
			sb18lim = 18;
		} else {
			sb18lim = 558;
		}
		for (sb18 = 0; sb18 < sb18lim; sb18 += 18) {
			for (ss = 0; ss < 8; ss++) {
				var src_idx1 = sb18 + 17 - ss;
				var src_idx2 = sb18 + 18 + ss;
				var bu = out_1d[src_idx1];
				var bd = out_1d[src_idx2];
				out_1d[src_idx1] = (bu * MP3Layer3.cs[ss]) - (bd * MP3Layer3.ca[ss]);
				out_1d[src_idx2] = (bd * MP3Layer3.cs[ss]) + (bu * MP3Layer3.ca[ss]);
			}
		}
	}
	var tsOutCopy = new Float32Array(18);
	var rawout = new Float32Array(36);
	function arraycopy(_in, a, out, b, c) {
		var _ = 0;
		for (var i = b; i < c; i++) {
			out[i] = _in[a + _];
			_++;
		}
	}
	MP3Layer3.prototype.hybrid = function(ch, gr) {
		var si = this.si;
		var out_1d = this.out_1d;
		var bt = 0;
		var sb18 = 0;
		var gr_info = (si.ch[ch].gr[gr]);
		var tsOut = null;
		var prvblk = null;
		for (sb18 = 0; sb18 < 576; sb18 += 18) {
			bt = ((gr_info.window_switching_flag != 0) && (gr_info.mixed_block_flag != 0) && (sb18 < 36)) ? 0 : gr_info.block_type;
			tsOut = out_1d;
			arraycopy(tsOut, 0 + sb18, tsOutCopy, 0, 18);
			this.inv_mdct(tsOutCopy, rawout, bt);
			arraycopy(tsOutCopy, 0, tsOut, 0 + sb18, 18);
			prvblk = this.prevblck;
			tsOut[0 + sb18] = rawout[0] + prvblk[ch][sb18 + 0];
			prvblk[ch][sb18 + 0] = rawout[18];
			tsOut[1 + sb18] = rawout[1] + prvblk[ch][sb18 + 1];
			prvblk[ch][sb18 + 1] = rawout[19];
			tsOut[2 + sb18] = rawout[2] + prvblk[ch][sb18 + 2];
			prvblk[ch][sb18 + 2] = rawout[20];
			tsOut[3 + sb18] = rawout[3] + prvblk[ch][sb18 + 3];
			prvblk[ch][sb18 + 3] = rawout[21];
			tsOut[4 + sb18] = rawout[4] + prvblk[ch][sb18 + 4];
			prvblk[ch][sb18 + 4] = rawout[22];
			tsOut[5 + sb18] = rawout[5] + prvblk[ch][sb18 + 5];
			prvblk[ch][sb18 + 5] = rawout[23];
			tsOut[6 + sb18] = rawout[6] + prvblk[ch][sb18 + 6];
			prvblk[ch][sb18 + 6] = rawout[24];
			tsOut[7 + sb18] = rawout[7] + prvblk[ch][sb18 + 7];
			prvblk[ch][sb18 + 7] = rawout[25];
			tsOut[8 + sb18] = rawout[8] + prvblk[ch][sb18 + 8];
			prvblk[ch][sb18 + 8] = rawout[26];
			tsOut[9 + sb18] = rawout[9] + prvblk[ch][sb18 + 9];
			prvblk[ch][sb18 + 9] = rawout[27];
			tsOut[10 + sb18] = rawout[10] + prvblk[ch][sb18 + 10];
			prvblk[ch][sb18 + 10] = rawout[28];
			tsOut[11 + sb18] = rawout[11] + prvblk[ch][sb18 + 11];
			prvblk[ch][sb18 + 11] = rawout[29];
			tsOut[12 + sb18] = rawout[12] + prvblk[ch][sb18 + 12];
			prvblk[ch][sb18 + 12] = rawout[30];
			tsOut[13 + sb18] = rawout[13] + prvblk[ch][sb18 + 13];
			prvblk[ch][sb18 + 13] = rawout[31];
			tsOut[14 + sb18] = rawout[14] + prvblk[ch][sb18 + 14];
			prvblk[ch][sb18 + 14] = rawout[32];
			tsOut[15 + sb18] = rawout[15] + prvblk[ch][sb18 + 15];
			prvblk[ch][sb18 + 15] = rawout[33];
			tsOut[16 + sb18] = rawout[16] + prvblk[ch][sb18 + 16];
			prvblk[ch][sb18 + 16] = rawout[34];
			tsOut[17 + sb18] = rawout[17] + prvblk[ch][sb18 + 17];
			prvblk[ch][sb18 + 17] = rawout[35];
		}
	}
	MP3Layer3.win = [new Float32Array([-1.6141214951E-02, -5.3603178919E-02, -1.0070713296E-01, -1.6280817573E-01, -4.9999999679E-01, -3.8388735032E-01, -6.2061144372E-01, -1.1659756083E+00, -3.8720752656E+00, -4.2256286556E+00, -1.5195289984E+00, -9.7416483388E-01, -7.3744074053E-01, -1.2071067773E+00, -5.1636156596E-01, -4.5426052317E-01, -4.0715656898E-01, -3.6969460527E-01, -3.3876269197E-01, -3.1242222492E-01, -2.8939587111E-01, -2.6880081906E-01, -5.0000000266E-01, -2.3251417468E-01, -2.1596714708E-01, -2.0004979098E-01, -1.8449493497E-01, -1.6905846094E-01, -1.5350360518E-01, -1.3758624925E-01, -1.2103922149E-01, -2.0710679058E-01, -8.4752577594E-02, -6.4157525656E-02, -4.1131172614E-02, -1.4790705759E-02]), new Float32Array([-1.6141214951E-02, -5.3603178919E-02, -1.0070713296E-01, -1.6280817573E-01, -4.9999999679E-01, -3.8388735032E-01, -6.2061144372E-01, -1.1659756083E+00, -3.8720752656E+00, -4.2256286556E+00, -1.5195289984E+00, -9.7416483388E-01, -7.3744074053E-01, -1.2071067773E+00, -5.1636156596E-01, -4.5426052317E-01, -4.0715656898E-01, -3.6969460527E-01, -3.3908542600E-01, -3.1511810350E-01, -2.9642226150E-01, -2.8184548650E-01, -5.4119610000E-01, -2.6213228100E-01, -2.5387916537E-01, -2.3296291359E-01, -1.9852728987E-01, -1.5233534808E-01, -9.6496400054E-02, -3.3423828516E-02, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00]), new Float32Array([-4.8300800645E-02, -1.5715656932E-01, -2.8325045177E-01, -4.2953747763E-01, -1.2071067795E+00, -8.2426483178E-01, -1.1451749106E+00, -1.7695290101E+00, -4.5470225061E+00, -3.4890531002E+00, -7.3296292804E-01, -1.5076514758E-01, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00]), new Float32Array([0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, 0.0000000000E+00, -1.5076513660E-01, -7.3296291107E-01, -3.4890530566E+00, -4.5470224727E+00, -1.7695290031E+00, -1.1451749092E+00, -8.3137738100E-01, -1.3065629650E+00, -5.4142014250E-01, -4.6528974900E-01, -4.1066990750E-01, -3.7004680800E-01, -3.3876269197E-01, -3.1242222492E-01, -2.8939587111E-01, -2.6880081906E-01, -5.0000000266E-01, -2.3251417468E-01, -2.1596714708E-01, -2.0004979098E-01, -1.8449493497E-01, -1.6905846094E-01, -1.5350360518E-01, -1.3758624925E-01, -1.2103922149E-01, -2.0710679058E-01, -8.4752577594E-02, -6.4157525656E-02, -4.1131172614E-02, -1.4790705759E-02])];
	MP3Layer3.prototype.inv_mdct = function(_in, out, block_type) {
		var win_bt = 0;
		var i = 0;
		var tmpf_0, tmpf_1, tmpf_2, tmpf_3, tmpf_4, tmpf_5, tmpf_6, tmpf_7, tmpf_8, tmpf_9;
		var tmpf_10, tmpf_11, tmpf_12, tmpf_13, tmpf_14, tmpf_15, tmpf_16, tmpf_17;
		tmpf_0 = tmpf_1 = tmpf_2 = tmpf_3 = tmpf_4 = tmpf_5 = tmpf_6 = tmpf_7 = tmpf_8 = tmpf_9 = tmpf_10 = tmpf_11 = tmpf_12 = tmpf_13 = tmpf_14 = tmpf_15 = tmpf_16 = tmpf_17 = 0.0;
		if (block_type == 2) {
			out[0] = 0.0;
			out[1] = 0.0;
			out[2] = 0.0;
			out[3] = 0.0;
			out[4] = 0.0;
			out[5] = 0.0;
			out[6] = 0.0;
			out[7] = 0.0;
			out[8] = 0.0;
			out[9] = 0.0;
			out[10] = 0.0;
			out[11] = 0.0;
			out[12] = 0.0;
			out[13] = 0.0;
			out[14] = 0.0;
			out[15] = 0.0;
			out[16] = 0.0;
			out[17] = 0.0;
			out[18] = 0.0;
			out[19] = 0.0;
			out[20] = 0.0;
			out[21] = 0.0;
			out[22] = 0.0;
			out[23] = 0.0;
			out[24] = 0.0;
			out[25] = 0.0;
			out[26] = 0.0;
			out[27] = 0.0;
			out[28] = 0.0;
			out[29] = 0.0;
			out[30] = 0.0;
			out[31] = 0.0;
			out[32] = 0.0;
			out[33] = 0.0;
			out[34] = 0.0;
			out[35] = 0.0;
			var six_i = 0;
			for (i = 0; i < 3; i++) {
				_in[15 + i] += _in[12 + i];
				_in[12 + i] += _in[9 + i];
				_in[9 + i] += _in[6 + i];
				_in[6 + i] += _in[3 + i];
				_in[3 + i] += _in[0 + i];
				_in[15 + i] += _in[9 + i];
				_in[9 + i] += _in[3 + i];
				var pp1, pp2, sum = 0;
				pp2 = _in[12 + i] * 0.500000000;
				pp1 = _in[6 + i] * 0.866025403;
				sum = _in[0 + i] + pp2;
				tmpf_1 = _in[0 + i] - _in[12 + i];
				tmpf_0 = sum + pp1;
				tmpf_2 = sum - pp1;
				pp2 = _in[15 + i] * 0.500000000;
				pp1 = _in[9 + i] * 0.866025403;
				sum = _in[3 + i] + pp2;
				tmpf_4 = _in[3 + i] - _in[15 + i];
				tmpf_5 = sum + pp1;
				tmpf_3 = sum - pp1;
				tmpf_3 *= 1.931851653;
				tmpf_4 *= 0.707106781;
				tmpf_5 *= 0.517638090;
				var save = tmpf_0;
				tmpf_0 += tmpf_5;
				tmpf_5 = save - tmpf_5;
				save = tmpf_1;
				tmpf_1 += tmpf_4;
				tmpf_4 = save - tmpf_4;
				save = tmpf_2;
				tmpf_2 += tmpf_3;
				tmpf_3 = save - tmpf_3;
				tmpf_0 *= 0.504314480;
				tmpf_1 *= 0.541196100;
				tmpf_2 *= 0.630236207;
				tmpf_3 *= 0.821339815;
				tmpf_4 *= 1.306562965;
				tmpf_5 *= 3.830648788;
				tmpf_8 = -tmpf_0 * 0.793353340;
				tmpf_9 = -tmpf_0 * 0.608761429;
				tmpf_7 = -tmpf_1 * 0.923879532;
				tmpf_10 = -tmpf_1 * 0.382683432;
				tmpf_6 = -tmpf_2 * 0.991444861;
				tmpf_11 = -tmpf_2 * 0.130526192;
				tmpf_0 = tmpf_3;
				tmpf_1 = tmpf_4 * 0.382683432;
				tmpf_2 = tmpf_5 * 0.608761429;
				tmpf_3 = -tmpf_5 * 0.793353340;
				tmpf_4 = -tmpf_4 * 0.923879532;
				tmpf_5 = -tmpf_0 * 0.991444861;
				tmpf_0 *= 0.130526192;
				out[six_i + 6] += tmpf_0;
				out[six_i + 7] += tmpf_1;
				out[six_i + 8] += tmpf_2;
				out[six_i + 9] += tmpf_3;
				out[six_i + 10] += tmpf_4;
				out[six_i + 11] += tmpf_5;
				out[six_i + 12] += tmpf_6;
				out[six_i + 13] += tmpf_7;
				out[six_i + 14] += tmpf_8;
				out[six_i + 15] += tmpf_9;
				out[six_i + 16] += tmpf_10;
				out[six_i + 17] += tmpf_11;
				six_i += 6;
			}
		} else {
			_in[17] += _in[16];
			_in[16] += _in[15];
			_in[15] += _in[14];
			_in[14] += _in[13];
			_in[13] += _in[12];
			_in[12] += _in[11];
			_in[11] += _in[10];
			_in[10] += _in[9];
			_in[9] += _in[8];
			_in[8] += _in[7];
			_in[7] += _in[6];
			_in[6] += _in[5];
			_in[5] += _in[4];
			_in[4] += _in[3];
			_in[3] += _in[2];
			_in[2] += _in[1];
			_in[1] += _in[0];
			_in[17] += _in[15];
			_in[15] += _in[13];
			_in[13] += _in[11];
			_in[11] += _in[9];
			_in[9] += _in[7];
			_in[7] += _in[5];
			_in[5] += _in[3];
			_in[3] += _in[1];
			var tmp0 = 0, tmp1 = 0, tmp2 = 0, tmp3 = 0, tmp4 = 0, tmp0_ = 0, tmp1_ = 0, tmp2_ = 0, tmp3_ = 0;
			var tmp0o, tmp1o, tmp2o, tmp3o, tmp4o, tmp0_o, tmp1_o, tmp2_o, tmp3_o = 0;
			var i00 = _in[0] + _in[0];
			var iip12 = i00 + _in[12];
			tmp0 = iip12 + _in[4] * 1.8793852415718 + _in[8] * 1.532088886238 + _in[16] * 0.34729635533386;
			tmp1 = i00 + _in[4] - _in[8] - _in[12] - _in[12] - _in[16];
			tmp2 = iip12 - _in[4] * 0.34729635533386 - _in[8] * 1.8793852415718 + _in[16] * 1.532088886238;
			tmp3 = iip12 - _in[4] * 1.532088886238 + _in[8] * 0.34729635533386 - _in[16] * 1.8793852415718;
			tmp4 = _in[0] - _in[4] + _in[8] - _in[12] + _in[16];
			var i66_ = _in[6] * 1.732050808;
			tmp0_ = _in[2] * 1.9696155060244 + i66_ + _in[10] * 1.2855752193731 + _in[14] * 0.68404028665134;
			tmp1_ = (_in[2] - _in[10] - _in[14]) * 1.732050808;
			tmp2_ = _in[2] * 1.2855752193731 - i66_ - _in[10] * 0.68404028665134 + _in[14] * 1.9696155060244;
			tmp3_ = _in[2] * 0.68404028665134 - i66_ + _in[10] * 1.9696155060244 - _in[14] * 1.2855752193731;
			var i0 = _in[0 + 1] + _in[0 + 1];
			var i0p12 = i0 + _in[12 + 1];
			tmp0o = i0p12 + _in[4 + 1] * 1.8793852415718 + _in[8 + 1] * 1.532088886238 + _in[16 + 1] * 0.34729635533386;
			tmp1o = i0 + _in[4 + 1] - _in[8 + 1] - _in[12 + 1] - _in[12 + 1] - _in[16 + 1];
			tmp2o = i0p12 - _in[4 + 1] * 0.34729635533386 - _in[8 + 1] * 1.8793852415718 + _in[16 + 1] * 1.532088886238;
			tmp3o = i0p12 - _in[4 + 1] * 1.532088886238 + _in[8 + 1] * 0.34729635533386 - _in[16 + 1] * 1.8793852415718;
			tmp4o = (_in[0 + 1] - _in[4 + 1] + _in[8 + 1] - _in[12 + 1] + _in[16 + 1]) * 0.707106781; // Twiddled
			var i6_ = _in[6 + 1] * 1.732050808;
			tmp0_o = _in[2 + 1] * 1.9696155060244 + i6_ + _in[10 + 1] * 1.2855752193731 + _in[14 + 1] * 0.68404028665134;
			tmp1_o = (_in[2 + 1] - _in[10 + 1] - _in[14 + 1]) * 1.732050808;
			tmp2_o = _in[2 + 1] * 1.2855752193731 - i6_ - _in[10 + 1] * 0.68404028665134 + _in[14 + 1] * 1.9696155060244;
			tmp3_o = _in[2 + 1] * 0.68404028665134 - i6_ + _in[10 + 1] * 1.9696155060244 - _in[14 + 1] * 1.2855752193731;
			var e, o = 0;
			e = tmp0 + tmp0_;
			o = (tmp0o + tmp0_o) * 0.501909918;
			tmpf_0 = e + o;
			tmpf_17 = e - o;
			e = tmp1 + tmp1_;
			o = (tmp1o + tmp1_o) * 0.517638090;
			tmpf_1 = e + o;
			tmpf_16 = e - o;
			e = tmp2 + tmp2_;
			o = (tmp2o + tmp2_o) * 0.551688959;
			tmpf_2 = e + o;
			tmpf_15 = e - o;
			e = tmp3 + tmp3_;
			o = (tmp3o + tmp3_o) * 0.610387294;
			tmpf_3 = e + o;
			tmpf_14 = e - o;
			tmpf_4 = tmp4 + tmp4o;
			tmpf_13 = tmp4 - tmp4o;
			e = tmp3 - tmp3_;
			o = (tmp3o - tmp3_o) * 0.871723397;
			tmpf_5 = e + o;
			tmpf_12 = e - o;
			e = tmp2 - tmp2_;
			o = (tmp2o - tmp2_o) * 1.183100792;
			tmpf_6 = e + o;
			tmpf_11 = e - o;
			e = tmp1 - tmp1_;
			o = (tmp1o - tmp1_o) * 1.931851653;
			tmpf_7 = e + o;
			tmpf_10 = e - o;
			e = tmp0 - tmp0_;
			o = (tmp0o - tmp0_o) * 5.736856623;
			tmpf_8 = e + o;
			tmpf_9 = e - o;
			win_bt = MP3Layer3.win[block_type];
			out[0] = -tmpf_9 * win_bt[0];
			out[1] = -tmpf_10 * win_bt[1];
			out[2] = -tmpf_11 * win_bt[2];
			out[3] = -tmpf_12 * win_bt[3];
			out[4] = -tmpf_13 * win_bt[4];
			out[5] = -tmpf_14 * win_bt[5];
			out[6] = -tmpf_15 * win_bt[6];
			out[7] = -tmpf_16 * win_bt[7];
			out[8] = -tmpf_17 * win_bt[8];
			out[9] = tmpf_17 * win_bt[9];
			out[10] = tmpf_16 * win_bt[10];
			out[11] = tmpf_15 * win_bt[11];
			out[12] = tmpf_14 * win_bt[12];
			out[13] = tmpf_13 * win_bt[13];
			out[14] = tmpf_12 * win_bt[14];
			out[15] = tmpf_11 * win_bt[15];
			out[16] = tmpf_10 * win_bt[16];
			out[17] = tmpf_9 * win_bt[17];
			out[18] = tmpf_8 * win_bt[18];
			out[19] = tmpf_7 * win_bt[19];
			out[20] = tmpf_6 * win_bt[20];
			out[21] = tmpf_5 * win_bt[21];
			out[22] = tmpf_4 * win_bt[22];
			out[23] = tmpf_3 * win_bt[23];
			out[24] = tmpf_2 * win_bt[24];
			out[25] = tmpf_1 * win_bt[25];
			out[26] = tmpf_0 * win_bt[26];
			out[27] = tmpf_0 * win_bt[27];
			out[28] = tmpf_1 * win_bt[28];
			out[29] = tmpf_2 * win_bt[29];
			out[30] = tmpf_3 * win_bt[30];
			out[31] = tmpf_4 * win_bt[31];
			out[32] = tmpf_5 * win_bt[32];
			out[33] = tmpf_6 * win_bt[33];
			out[34] = tmpf_7 * win_bt[34];
			out[35] = tmpf_8 * win_bt[35];
		}
	}
	const SampleBuffer = function(sample_frequency, number_of_channels) {
		this.buffer = new Int16Array(SampleBuffer.OBUFFERSIZE);
		this.bufferp = new Int32Array(SampleBuffer.MAXCHANNELS);
		this.channels = number_of_channels;
		this.frequency = sample_frequency;
		for (var i = 0; i < number_of_channels; ++i)
			this.bufferp[i] = i;
	}
	SampleBuffer.OBUFFERSIZE = 2 * 1152;
	SampleBuffer.MAXCHANNELS = 2;
	SampleBuffer.prototype.getChannelCount = function() {
		return this.channels;
	}
	SampleBuffer.prototype.getSampleFrequency = function() {
		return this.frequency;
	}
	SampleBuffer.prototype.getBuffer = function() {
		return this.buffer;
	}
	SampleBuffer.prototype.getBufferLength = function() {
		return this.bufferp[0];
	}
	SampleBuffer.prototype.write_buffer = function() {
	}
	SampleBuffer.prototype.clear_buffer = function() {
		for (var i = 0; i < this.channels; ++i)
			this.bufferp[i] = i;
	}
	SampleBuffer.prototype.appendSamples = function(channel, f) {
		var pos = this.bufferp[channel];
		var s;
		var fs;
		for (var i = 0; i < 32; ) {
			fs = f[i++];
			fs = (fs > 32767.0 ? 32767.0 : (Math.max(fs, -32767.0)));
			s = fs << 16 >> 16;
			this.buffer[pos] = s;
			pos += this.channels;
		}
		this.bufferp[channel] = pos;
	}
	const MP3Decoder = function() {
		this.output = null;
		this.initialized = false;
	}
	MP3Decoder.prototype.setOutputBuffer = function(out) {
		this.output = out;
	}
	MP3Decoder.prototype.initialize = function(header) {
		var scalefactor = 32700;
		var mode = header.mode();
		var channels = mode == MP3Header.SINGLE_CHANNEL ? 1 : 2;
		if (this.output == null) this.output = new SampleBuffer(header.frequency(), channels);
		this.filter1 = new SynthesisFilter(0, scalefactor, null);
		if (channels == 2) this.filter2 = new SynthesisFilter(1, scalefactor, null);
		this.outputChannels = channels;
		this.outputFrequency = header.frequency();
		this.initialized = true;
	}
	MP3Decoder.prototype.decodeFrame = function(header, stream) {
		if (!this.initialized) {
			this.initialize(header);
		}
		this.output.clear_buffer();
		var decoder = this.retrieveDecoder(header, stream);
		decoder.decodeFrame();
		this.output.write_buffer(1);
		return this.output;
	}
	MP3Decoder.prototype.retrieveDecoder = function(header, stream) {
		if (this.l3decoder == null) {
			this.l3decoder = new MP3Layer3(stream, header, this.filter1, this.filter2, this.output);
		}
		return this.l3decoder;
	}
	const MP3StreamDecoder = function(data) {
		this.stream = data;
		this._frame = null;
		this._prevMainDataBits = null;
		this.bitstream = new BitStream();
		this.header = new MP3Header();
		this.firstHeader = 0;
		this.sampleIndex = 0;
		this.sampleCount = 0;
		this.frameCount = 0;
		this.version = 0;
		this.channels = 0;
		this.tags = null;
		this.startFrame = [];
		this.type = 'MP3';
		this.decoder = new MP3Decoder();
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
	MP3StreamDecoder.prototype.readHeader = function(_header) {
		var mp3FrameHeader = _header || new MP3Header();
		while (this.stream.getBytesAvailable() > 4) {
			var frameStart = this.stream.position;
			var header = this.stream.readInt();
			if (MP3Header.isValidHeader(header)) {
				mp3FrameHeader.parseHeader(header);
				return mp3FrameHeader;
			}
			this.stream.position = frameStart + 1;
		}
		return null;
	}
	MP3StreamDecoder.prototype.appendFrame = function() {
		var header = this.readHeader(this.header);
		var frameStream = this.stream.readBytes(header.framesize);
		this.bitstream.setData(new Uint8Array(frameStream));
		var buf = this.decoder.decodeFrame(header, this.bitstream);
		var pcm = buf.getBuffer();
		var sc = ((this.version == MP3Header.MPEG1) ? 1152 : 576) * this.channels;
		for (var i = 0; i < sc; i++) {
			this.writeSample(i % this.channels, this.sampleIndex + (i / this.channels) | 0, (pcm[i] / 32768));
		}
	}
	MP3StreamDecoder.prototype.start = function() {
		this.tags = this.readTags();
		var pos = this.stream.position;
		this.firstHeader = this.readHeader();
		this.rate = this.firstHeader.frequency();
		this.channels = this.firstHeader.mode() == MP3Header.SINGLE_CHANNEL ? 1 : 2;
		this.type = 'VERSION ' + MP3Header.versionTable[this.firstHeader.version()] + " LAYER " + this.firstHeader.layer();
		this.version = this.firstHeader.version();
		this.stream.position = pos;
		var frameStarts = [];
		var frameCount = 0;
		while (this.stream.getBytesAvailable() > 4) {
			var result = this.readHeader();
			if (result == null) {
				break;
			}
			frameStarts.push(this.stream.position);
			var eeee = result.framesize;
			if (!((this.stream.getBytesAvailable() - eeee) > 4)) {
				break;
			}
			frameCount += 1;
			this.stream.position += eeee;
		}
		this.startFrame = frameStarts;
		this.frameCount = frameCount;
		this.sampleCount = (frameCount * ((this.version == MP3Header.MPEG1) ? 1152 : 576));
		this.stream.position = pos;
	}
	MP3StreamDecoder.prototype.getByteLength = function() {
		return this.stream.getLength();
	}
	MP3StreamDecoder.prototype.nextSample = function() {
		this.sampleIndex += ((this.version == MP3Header.MPEG1) ? 1152 : 576);
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
		setInterval(this.step.bind(this), 10);
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
	Player.prototype.getTypeFormat = function() {
		var typ = 'dat';
		if (this.stream instanceof MP3StreamDecoder) {
			typ = 'mp3';
		} else {
			typ = 'wav';
		}
		return typ;
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
			this.isEstreno = parser.channels == 2;
			this.buffer = this.audioContext.createBuffer(parser.channels, this.sampleCount, this.rate);
			parser.setChannels(this.buffer);
			parser.step();
			this.stream = parser;
			this.isLoad = true;
		} catch (e) {
			console.log("Reject! ", e);
		}
	}
	return {
		Player,
		ArrayBufferStream
	}
}());