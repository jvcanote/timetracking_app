module.exports = {
  secondsToTimeString: function(seconds) {
    var negative = seconds < 0,
        absValue = Math.abs(seconds),
        hours    = Math.floor(absValue / 3600),
        minutes  = Math.floor((absValue - (hours * 3600)) / 60),
        secs     = absValue - (hours * 3600) - (minutes * 60);

    var timeString = helpers.fmt('%@:%@:%@',
      this.addInsignificantZero(hours),
      this.addInsignificantZero(minutes),
      this.addInsignificantZero(secs)
    );

    return (negative ? '-' : '') + timeString;
  },

  simpleFormat: /^-?\d+$/,

  complexFormat: /^(\d{0,2}):(\d{0,2}):(\d{0,2})$/,

  timeStringToSeconds: function(timeString, simple) {
    var result;

    if (simple) {
      result = timeString.match(this.simpleFormat);

      if (!result) { throw { message: 'bad_time_format' }; }

      return parseInt(result[0], 10) * 60;
    } else {
      result = timeString.match(this.complexFormat);

      if (!result || result.length != 4) { throw { message: 'bad_time_format' }; }

      return this.parseIntWithDefault(result[1]) * 3600 +
        this.parseIntWithDefault(result[2]) * 60 +
        this.parseIntWithDefault(result[3]);
    }
  },

  parseIntWithDefault: function(num, def) {
    return parseInt(num, 10) || def || 0;
  },

  addInsignificantZero: function(n) {
    return ( n < 10 ? '0' : '') + n;
  }
};
