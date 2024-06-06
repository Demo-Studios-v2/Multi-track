/**
 * @param {Number} n - peak to convert from float to Int8, Int16 etc.
 * @param {Number} bits - convert to #bits two's complement signed integer
 */
function convert(n, bits) {
  var max = Math.pow(2, bits - 1);
  var v = n < 0 ? n * max : n * (max - 1);
  return Math.max(-max, Math.min(max - 1, v));
}

/**
 * @param {TypedArray} channel - Audio track frames to calculate peaks from.
 * @param {Number} samplesPerPixel - Audio frames per peak
 */
function extractPeaks(channel, samplesPerPixel, bits) {
  var i;
  var chanLength = channel.length;
  var numPeaks = Math.ceil(chanLength / samplesPerPixel);
  var start = 0;
  var end;
  var min = Infinity;
  var max = -Infinity;
  var curr;
  console.log("third");
  var peaks = makeTypedArray(bits, numPeaks * 2);

  for (i = 0; i < numPeaks; i++) {
    end = Math.min((i + 1) * samplesPerPixel, chanLength);

    for (var j = start; j < end; j++) {
      curr = channel[j];
      if (min > curr) {
        min = curr;
      }
      if (max < curr) {
        max = curr;
      }
    }

    peaks[i * 2] = convert(min, bits);
    peaks[i * 2 + 1] = convert(max, bits);

    start = end;
    min = Infinity;
    max = -Infinity;
  }

  return peaks;
}

function makeTypedArray(bits, length) {
  return new (new Function(`return Int${bits}Array`)())(length);
}

function makeMono(channelPeaks, bits) {
  var numChan = channelPeaks.length;
  var weight = 1 / numChan;
  var numPeaks = channelPeaks[0].length / 2;
  var c = 0;
  var i = 0;
  var min;
  var max;
  var peaks = makeTypedArray(bits, numPeaks * 2);

  for (i = 0; i < numPeaks; i++) {
    min = 0;
    max = 0;

    for (c = 0; c < numChan; c++) {
      min += weight * channelPeaks[c][i * 2];
      max += weight * channelPeaks[c][i * 2 + 1];
    }

    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }

  //return in array so channel number counts still work.
  return [peaks];
}

function defaultNumber(value, defaultNumber) {
  if (typeof value === "number") {
    return value;
  } else {
    return defaultNumber;
  }
}

/**
 * @param {AudioBuffer,TypedArray} source - Source of audio samples for peak calculations.
 * @param {Number} samplesPerPixel - Number of audio samples per peak.
 * @param {Boolean} isMono - Whether to render the channels to a single array.
 * @param {Number} cueIn - index in channel to start peak calculations from.
 * @param {Number} cueOut - index in channel to end peak calculations from (non-inclusive).
 * @param {Number} bits - number of bits for a peak.
 */
export default function (source, samplesPerPixel, isMono, cueIn, cueOut, bits) {
  samplesPerPixel = defaultNumber(samplesPerPixel, 1000);
  bits = defaultNumber(bits, 16);

  if (isMono === null || isMono === undefined) {
    isMono = true;
  }

  if ([8, 16, 32].indexOf(bits) < 0) {
    throw new Error("Invalid number of bits specified for peaks.");
  }

  var numChan = source.numberOfChannels;
  var peaks = [];
  var c;
  var numPeaks;
  var channel;
  var slice;

  cueIn = defaultNumber(cueIn, 0);
  cueOut = defaultNumber(cueOut, source.length);

  if (typeof source.subarray === "undefined") {
    for (c = 0; c < numChan; c++) {
      channel = source.getChannelData(c);
      slice = channel.subarray(cueIn, cueOut);
      peaks.push(extractPeaks(slice, samplesPerPixel, bits));
    }
  } else {
    peaks.push(
      extractPeaks(source.subarray(cueIn, cueOut), samplesPerPixel, bits)
    );
  }

  if (isMono && peaks.length > 1) {
    peaks = makeMono(peaks, bits);
  }

  numPeaks = peaks[0].length / 2;

  return {
    length: numPeaks,
    data: peaks,
    bits: bits,
  };
}
