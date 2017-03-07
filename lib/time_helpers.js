function parseIntWithDefault(num, def) {
  return parseInt(num, 10) || def || 0;
}

function addInsignificantZero(n) {
  return ( n < 10 ? '0' : '') + n;
}

var simpleFormat = /^-?\d+$/;

var complexFormat = /^(\d{0,2}):(\d{0,2}):(\d{0,2})$/;

module.exports = {
  secondsToTimeString: function(seconds) {
    var negative = seconds < 0,
        absValue = Math.abs(seconds),
        hours    = Math.floor(absValue / 3600),
        minutes  = Math.floor((absValue - (hours * 3600)) / 60),
        secs     = absValue - (hours * 3600) - (minutes * 60);

    var timeString = helpers.fmt('%@:%@:%@',
      addInsignificantZero(hours),
      addInsignificantZero(minutes),
      addInsignificantZero(secs)
    );

    return (negative ? '-' : '') + timeString;
  },

  timeStringToSeconds: function(timeString, simple) {
    var result;

    if (simple) {
      result = timeString.match(simpleFormat);

      if (!result) { throw { message: 'bad_time_format' }; }

      return parseInt(result[0], 10) * 60;

    } else {
      result = timeString.match(complexFormat);

      if (!result || result.length != 4) { throw { message: 'bad_time_format' }; }

      return parseIntWithDefault(result[1]) * 3600 +
        parseIntWithDefault(result[2]) * 60 +
        parseIntWithDefault(result[3]);
    }
  }
};
