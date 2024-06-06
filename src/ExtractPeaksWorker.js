export default function () {
  function makeTypedArray(bits, length) {
    return new (new Function(`return Int${bits}Array`)())(length);
  }
  function convert(n, bits) {
    var max = Math.pow(2, bits - 1);
    var v = n < 0 ? n * max : n * (max - 1);
    return Math.max(-max, Math.min(max - 1, v));
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

  function extractPeaksCalc(channel, samplesPerPixelArray, bits) {
    var chanLength = channel.length;
    var numConfigs = samplesPerPixelArray.length;
    var peaksArray = [];
    var starts = Array(numConfigs).fill(0);
    var mins = Array(numConfigs).fill(Infinity);
    var maxs = Array(numConfigs).fill(-Infinity);
    var peakLengths = samplesPerPixelArray.map(
      (samplesPerPixel) => Math.ceil(chanLength / samplesPerPixel) * 2
    );

    for (var i = 0; i < numConfigs; i++) {
      peaksArray.push(makeTypedArray(bits, peakLengths[i]));
    }

    for (var i = 0; i < chanLength; i++) {
      var curr = channel[i];

      for (var j = 0; j < numConfigs; j++) {
        var samplesPerPixel = samplesPerPixelArray[j];
        var end = Math.min(starts[j] + samplesPerPixel, chanLength);

        mins[j] = Math.min(mins[j], curr);
        maxs[j] = Math.max(maxs[j], curr);

        if (i + 1 === end) {
          var peakIndex = (starts[j] / samplesPerPixel) * 2;
          peaksArray[j][peakIndex] = convert(mins[j], bits);
          peaksArray[j][peakIndex + 1] = convert(maxs[j], bits);
          starts[j] = end;
          mins[j] = Infinity;
          maxs[j] = -Infinity;
        }
      }
    }

    return samplesPerPixelArray.map((samplesPerPixel, index) => ({
      samplesPerPixel: samplesPerPixel,
      peaks: peaksArray[index],
    }));
  }

  function defaultNumber(value, defaultNumber) {
    if (typeof value === "number") {
      return value;
    } else {
      return defaultNumber;
    }
  }
  function extractPeaks(
    source,
    samplesPerPixelArray,
    isMono,
    cueIn,
    cueOut,
    bits,
    numChan
  ) {
    bits = defaultNumber(bits, 16);

    if (isMono === null || isMono === undefined) {
      isMono = true;
    }

    if ([8, 16, 32].indexOf(bits) < 0) {
      throw new Error("Invalid number of bits specified for peaks.");
    }

    var peaks = [];
    var c;
    var channel;
    var slice;

    cueIn = defaultNumber(cueIn, 0);
    cueOut = defaultNumber(cueOut, source.length);
    for (c = 0; c < numChan; c++) {
      channel = source[c];
      slice = channel.subarray(cueIn, cueOut);
      peaks.push(extractPeaksCalc(slice, samplesPerPixelArray, bits));
    }
    let peaksPerZoom = {};

    for (var i = 0; i < samplesPerPixelArray.length; i++) {
      peaksPerZoom[samplesPerPixelArray[i]] = [];
      for (c = 0; c < numChan; c++) {
        peaksPerZoom[samplesPerPixelArray[i]].push(peaks[c][i].peaks);
      }
      if (isMono && numChan > 1) {
        peaksPerZoom[samplesPerPixelArray[i]] = makeMono(
          peaksPerZoom[samplesPerPixelArray[i]],
          bits
        );
      }
      peaksPerZoom[samplesPerPixelArray[i]] = {
        data: peaksPerZoom[samplesPerPixelArray[i]],
        length: peaksPerZoom[samplesPerPixelArray[i]][0].length / 2,
        bits,
      };
    }
    return peaksPerZoom;
  }
  onmessage = async function (e) {
    try {
      const {
        source,
        samplesPerPixelArray,
        isMono,
        cueIn,
        cueOut,
        bits,
        numChan,
      } = e.data;
      const peaks = extractPeaks(
        source,
        samplesPerPixelArray,
        isMono,
        cueIn,
        cueOut,
        bits,
        numChan
      );
      postMessage({ peaks, taskId: e.data.taskId });
    } catch (error) {
      postMessage({ error: error, taskId: e.data.taskId });
    }
  };
}
