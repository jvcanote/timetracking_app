function mergePagedData(pages) {
  return  _.reduce(pages, function(memo, page) {
    memo.count = page.count;

    _.forEach(page, function(value, property) {
      if (Array.isArray(value)) {
        memo[property] = (memo[property] || []).concat(value);
      }
    });

    return memo;
  }, {});
};

module.exports = {

  ajaxPaged: function() {
    var request = this.ajax.apply(this, arguments);

    return this.promise(function(res, rej) {
      var allPages = [];

      request.done(function done(response) {
        allPages.push(response);

        if (response.next_page) {
          this.ajax('nextPage', response.next_page).done(done).fail(rej);

        } else {
          res(mergePagedData(allPages));
        }
      }.bind(this)).fail(rej);
    }.bind(this));
  },

  requests: {
    nextPage: function(url) {
      return {
        url: url
      };
    },

    audits: function() {
      return {
        url: helpers.fmt('/api/v2/tickets/%@/audits.json?include=users', this.ticket().id())
      };
    },

    ticketForms: function() {
      return {
        url: '/api/v2/ticket_forms.json'
      };
    }
  }
};
