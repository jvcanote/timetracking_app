/*globals performance:false */
(function() {
  'use_strict';

  var totalTimeFieldId, timeFieldId;

  var TimeHelpers = require('time_helpers');

  // returns time in milliseconds
  function getTick() {
    // for newer browsers rely on performance.now()
    if (typeof performance !== 'undefined' && performance.now) {
      return Math.floor(performance.now());
    }

    // Otherwise fall back on Date.
    return (new Date()).valueOf();
  }

  return {
    SETUP_INFO: 'https://support.zendesk.com/hc/%@/articles/203662506',

    // Debugging only: only allow this maximum of seconds for any time tracking
    // update.
    MAX_TIME: 1209600, // 1209600 = two weeks in seconds

    requests: {
      fetchAuditsPage: function(url) {
        return {
          url: url || helpers.fmt(
            '/api/v2/tickets/%@/audits.json?include=users',
            this.ticket().id()
          )
        };
      },
      fetchTicketForms: function(url) {
        return {
          url: url || '/api/v2/ticket_forms.json'
        };
      }
    },

    events: {
      'app.created'             : 'onAppCreated',
      'app.activated'           : 'onAppActivated',
      'app.deactivated'         : 'onAppDeactivated',
      'app.willDestroy'         : 'onAppWillDestroy',
      'ticket.save'             : 'onTicketSave',
      'ticket.submit.done'      : 'onTicketSubmitDone',
      '*.changed'               : 'onAnyTicketFieldChanged',
      'ticket.updated'          : 'onTicketUpdated',
      'fetchAuditsPage.done'    : 'onFetchAuditsPageDone',
      'fetchAllAudits.done'     : 'onFetchAllAuditsDone',
      'click .pause'            : 'onPauseClicked',
      'click .play'             : 'onPlayClicked',
      'click .reset'            : 'onResetClicked',
      'click .time-modal-save'  : 'onTimeModalSaveClicked',
      'shown .time-modal'       : 'onTimeModalShown',
      'hidden .time-modal'      : 'onTimeModalHidden',
      'shown .resume-modal'     : 'onResumeModalShown',
      'click .resume-modal-yes' : 'onResumeModalYesClicked',
      'click .resume-modal-no'  : 'onResumeModalNoClicked',
      'click .expand-bar'       : 'onTimelogsClicked'
    },

    /*
     *
     *  EVENT CALLBACKS
     *
     */
    onAppCreated: function() {
      if (!timeFieldId || !totalTimeFieldId) {
        if (this.installationId() > 0) {
          var totalTimeField = this.requirement('total_time_field'),
              timeLastUpdateField = this.requirement('time_last_update_field');

          totalTimeFieldId = totalTimeField && totalTimeField.requirement_id;
          timeFieldId = timeLastUpdateField && timeLastUpdateField.requirement_id;

        } else {
          totalTimeFieldId = parseInt(this.setting('total_time_field_id'), 10);
          timeFieldId = parseInt(this.setting('time_field_id'), 10);
        }
      }

      this.initialize();

      if (this.setting('hide_from_agents') && this.currentUser().role() !== 'admin') {
        this.hide();
      }
    },

    onAppActivated: function(app) {
      if (!app.firstLoad) {
        this.onAppFocusIn();
      }
    },

    onAppWillDestroy: function() {
      this.clearTimeLoop();
    },

    onAppDeactivated: function() {
      if (this.setting('auto_pause_resume')) {
        this.pause();
      }
    },

    onAppFocusIn: function() {
      if (this.setting('auto_pause_resume') && !this.manuallyPaused) {
        this.resume();
      }
    },

    onAnyTicketFieldChanged: function() {
      _.defer(this.hideFields.bind(this));
      if (this.setting('resume_on_changes') && this.manuallyPaused && !this.refusedResume) {
        this.$('.resume-modal').modal('show');
      }
    },

    maxValueExceededDebugLogs: function(fname, timeAttempt) {
      // adding debugging setting for customers having issues with agents
      // submitting large values due to a possible bug
      //
      // Problem ticket: https://support.zendesk.com/agent/tickets/1637774
      var timestamp = new Date().toISOString();

      console.group('Zendesk Time Tracking App - Large Value Debug mode');
      console.log('DEBUG: Starting debug dump for administrators');
      console.log('DEBUG: Timestamp: ' + timestamp);
      console.log('DEBUG: Running in function ' + fname + '()');
      console.log('DEBUG: Time spent value attempt (s): ' + timeAttempt);
      console.log('DEBUG: Which is greater than MAX_TIME (s) of: ' +
          this.MAX_TIME);
      console.log('DEBUG: performance object exists: ' +
          (typeof performance == "object" ? 'yes' : 'no'));
      console.log('DEBUG: performance.now function exists: ' +
          (typeof performance.now == "function" ? 'yes' : 'no'));
    },

    onTicketSave: function() {
      if (this.setting('time_submission') && this.visible() && !this.invalid) {
        return this.promise(function(done, fail) {
          this.saveHookPromiseIsDone = false;
          this.saveHookPromiseIsDoneDebug = false;
          this.saveHookPromiseDone = done;
          this.saveHookPromiseFail = fail;

          this.renderTimeModal();
        }.bind(this));

      } else {
        if (this.setting('debug_prevent_huge_times')) {
          var timeAttempt = this.elapsedTime();

          if (timeAttempt > this.MAX_TIME) {
            // adding debugging setting for customers having issues with agents
      	    // submitting large values due to a possible bug
      	    //
      	    // Problem ticket: https://support.zendesk.com/agent/tickets/1637774
      	    this.maxValueExceededDebugLogs('onTicketSave', timeAttempt);
            console.log('DEBUG: returning a fail value');
            console.groupEnd('Zendesk Time Tracking App - Large Value Debug mode');
            // Throwing an exception here instead of just returning a string
            throw { message: 'DEBUG - Time Tracking: time spent last' +
              ' update is too large. Please see console for' +
              ' details and contact your administrator.' };
          }

        }
        this.commitTicketTime();

        return true;
      }
    },

    onTicketSubmitDone: function() {
      this.resetElapsedTime();
      _.delay(this.getTimelogs.bind(this), 1000);
    },

    onTicketUpdated: function(updatedBy) {
      if (updatedBy.id() !== this.currentUser().id()) {
        this.getTimelogs();
      }
    },

    onFetchAllAuditsDone: function() {
      var status = "";
      var timeDiff;

      // separate follow up audits from new audits
      var followUpAudits = [];
      var newAudits = [];

      _.each(this.store('audits'), function(audit) {
        if (!audit.via || !audit.via.source ||
          audit.via.source.rel !== 'follow_up') {
            newAudits.push(audit);
          }
        else {
          followUpAudits.push(audit);
        }
      });

      if (followUpAudits.length) {
        // Because of a change with how events are carried over to follow-up
        // tickets (zendesk/zendesk#26389) we want to only consider new audit
        // events
        if (newAudits.length) {

          var isThisEvent = function(event) {
            return event.field_name == totalTimeFieldId;
          };

          for (var i = 0; i < newAudits.length; i++) {
            var audit = newAudits[i],
              totalTimeEvent = _.find(audit.events, isThisEvent, this);

            if (totalTimeEvent) break;

            /* If we got to the last one without breaking out so far, we can reset it */
            if (i === newAudits.length - 1) {
              this.ticketFieldTotalTime('0');
            }
          }
        } else {
          this.ticketFieldTotalTime('0');
        }
      }

      // refresh the timelog display
      if (this.isTimelogsEnabled()) {
        var timelogs = _.reduce(newAudits, function(memo, audit) {
          var newStatus = _.find(audit.events, function(event) {
            return event.field_name == 'status';
          }, this),
          auditEvent = _.find(audit.events, function(event) {
            return event.field_name == totalTimeFieldId;
          }, this);

          if (newStatus) {
            status = newStatus.value;
          }

          if (auditEvent) {
            if (!memo.length) {
              auditEvent.previous_value = 0;
            }
            timeDiff = auditEvent.value - (auditEvent.previous_value || 0);
            memo.push({
              time: TimeHelpers.secondsToTimeString(parseInt(timeDiff, 10)),
              date: new Date(audit.created_at).toLocaleString(),
              status: status,
              // Guard around i18n status because some old apps don't have this
              localized_status: status ? this.I18n.t(helpers.fmt('statuses.%@', status)) : "",
              user: _.find(this.store('users'), function(user) {
                return user.id === audit.author_id;
              })
            });
          }

          return memo;
        }, [], this);

        this.renderTimelogs(timelogs.reverse());
      }
    },

    onPauseClicked: function(e) {
      var $el = this.$(e.currentTarget);

      $el.find('i').addClass('active');
      this.$('.play i').removeClass('active');

      this.refusedResume = false;
      this.manuallyPaused = true;
      this.pause();
    },

    onPlayClicked: function(e) {
      var $el = this.$(e.currentTarget);

      $el.find('i').addClass('active');
      this.$('.pause i').removeClass('active');

      this.manuallyPaused = false;
      this.resume();
    },

    onResetClicked: function() {
      this.resetElapsedTime();
    },

    onTimelogsClicked: function() {
      this.$('.timelogs-container').slideToggle();
      this.$('.expand-bar').toggleClass('expanded');
    },

    onTimeModalSaveClicked: function() {
      var timeString = this.$('.modal-time').val();

      try {

        // pre-emptive debugging for large values
        var timeAttempt = TimeHelpers.timeStringToSeconds(
                          timeString, this.setting('simple_submission'));

        if (this.setting('debug_prevent_huge_times') &&
                  timeAttempt > this.MAX_TIME) {
          // adding debugging setting for customers having issues with agents
          // submitting large values due to a possible bug
          //
          // Problem ticket: https://support.zendesk.com/agent/tickets/1637774
          this.maxValueExceededDebugLogs('onTimeModalSaveClicked', timeAttempt);

          // Fail updating the ticket by passing a false value to the modal
          // hide function
          console.log('DEBUG: setting saveHookPromiseIsDone to false to ' +
              'force ticket save failure');
          this.saveHookPromiseIsDone = false;
          this.saveHookPromiseIsDoneDebug = true;
        } else {
          this.commitTicketTime(timeAttempt);

          // flag here that saveHookPromiseDone is called after hiding the modal
          this.saveHookPromiseIsDone = true;
          this.saveHookPromiseDone();
        }

        this.$('.time-modal').modal('hide');

      } catch (e) {
        if (e.message == 'bad_time_format') {
          services.notify(this.I18n.t('errors.bad_time_format'), 'error');
        } else {
          throw e;
        }
      }
    },

    onTimeModalShown: function() {
      var timeout = 15,
          $timeout = this.$('span.modal-timer'),
          $modal = this.$('.time-modal');

      this.modalTimeoutID = setInterval(function() {
        timeout -= 1;

        $timeout.html(timeout);

        if (timeout === 0) {
          $modal.modal('hide');
        }
      }.bind(this), 1000);

      $modal.find('.time-modal-save').focus();
    },

    onTimeModalHidden: function() {
      clearInterval(this.modalTimeoutID);

      if (!this.saveHookPromiseIsDone) {
        if (this.saveHookPromiseIsDoneDebug) {
          this.saveHookPromiseFail('DEBUG: This update failed because the time spent is much too high. Please contact your admin and view the developer console for more details.');
          console.groupEnd('Zendesk Time Tracking App - Large Value Debug mode');
          // throw an exception as well
          throw { message: 'DEBUG: This update failed because the time spent is much too high. Please contact your admin and view the developer console for more details.' };
        } else {
          this.saveHookPromiseFail(this.I18n.t('errors.save_hook'));
        }
      }
    },

    onResumeModalShown: function() {
      this.$('.resume-modal').find('.resume-modal-yes').focus();
    },

    onResumeModalYesClicked: function() {
      this.$('.play').click();

      this.$('.resume-modal').modal('hide');
    },

    onResumeModalNoClicked: function() {
      this.refusedResume = true;
      this.$('.resume-modal').modal('hide');
    },

    /*
     *
     * METHODS
     *
     */

    checkForms: (function() {
      var forms = [];

      function fetch(url) {
        this.ajax('fetchTicketForms', url).done(callback.bind(this));
      }

      function callback(data) {
        forms.push.apply(forms, data.ticket_forms);

        if (data.next_page) {
          fetch.call(this, data.next_page);
        } else {
          var requiredTicketFieldIds = [
                timeFieldId,
                totalTimeFieldId
              ];

          forms = _.filter(forms, function(form) {
            return form.active;
          });

          var valid = _.all(forms, function(form) {
            return _.intersection(form.ticket_field_ids, requiredTicketFieldIds).length === requiredTicketFieldIds.length;
          });

          if (!valid) {
            this.invalid = true;
            var link = helpers.fmt(this.SETUP_INFO, this.localeForHC());
            this.switchTo('setup_info', { link: link });
            this.$('.expand-bar').remove();
            this.onAppWillDestroy();
          }
        }
      }

      return function() {
        if (!this.ticket().form().id()) { return; }

        fetch.call(this);
      };
    })(),

    initialize: function() {
      this.getTimelogs();
      this.hideFields();
      this.checkForms();

      this.resetNewTimers(); // new mechanism
      this.setTimeLoop();

      this.switchTo('main', {
        manualPauseResume: this.setting('manual_pause_resume'),
        displayReset: this.setting('reset'),
        displayTimelogs: this.isTimelogsEnabled()
      });
    },

    fetchAllAudits: function(url, data, callback) {
      this.store('audits', []);
      this.store('users', []);
      this.ajax('fetchAuditsPage');
    },

    onFetchAuditsPageDone: function(data) {
      this.store('audits', this.store('audits').concat(data.audits));
      this.store('users', this.store('users').concat(data.users));

      if (!data.next_page) {
        this.trigger('fetchAllAudits.done');
      } else {
        this.ajax('fetchAuditsPage', data.next_page);
      }
    },

    getTimelogs: function() {
      if (this.ticket() && this.ticket().id()) { this.fetchAllAudits(); }
    },

    updateMainView: function(time) {
      this.$('.live-timer').html(TimeHelpers.secondsToTimeString(time));
      this.$('.live-totaltimer').html(TimeHelpers.secondsToTimeString(
        this.ticketFieldTotalTime() + time
      ));
    },

    renderTimelogs: function(timelogs) {
      this.$('.timelogs-container')
        .html(this.renderTemplate('timelogs', {
          timelogs: timelogs
        }));

      this.$('tr').tooltip({ placement: 'left', html: true });
    },

    hideFields: function() {
      _.each([ timeFieldId, totalTimeFieldId ], function(fieldId) {
        var field = this.ticketFields(helpers.fmt('custom_field_%@', fieldId));

        if (field && field.isVisible()) {
          field.hide();
        }
      }, this);
    },

    /*
     * TIME RELATED
     */

    elapsedTime: function(time) {
      if (time !== undefined) {
        this.realElapsedTime = time * 1000;
      }
      return Math.floor(this.realElapsedTime / 1000);
    },

    setTimeLoop: function() {
      this.lastTick = getTick();
      this.elapsedTime(0);

      if (this.timeLoopID) { throw new Error('There is already a timeloop running for this instance.'); }

      this.timeLoopID = setInterval(function() {
        var now = getTick();
        if (!this.isPaused()) {
          this.realElapsedTime += now - this.lastTick;

          this.updateMainView(this.elapsedTime());
        }
        this.lastTick = now;
      }.bind(this), 1000);
    },

    clearTimeLoop: function() {
      clearInterval(this.timeLoopID);
      this.timeLoopID = undefined;
    },

    renderTimeModal: function() {
      if (this.setting('simple_submission')) {
        this.$('.modal-time').val(Math.floor(this.elapsedTime() / 60));
      } else {
        this.$('.modal-time').val(TimeHelpers.secondsToTimeString(this.elapsedTime()));
      }
      this.$('.time-modal').modal('show');
    },

    resetElapsedTime: function() {
      this.elapsedTime(0);
      this.updateMainView(this.elapsedTime());
    },

    /*
     *
     * Four new function to calculate time! Independent of any of the other code.
     *
     */

    // new mechanism to count
    resetNewTimers: function() {
      this.startTime = getTick();
      this.elapsedPausedTime = 0;
      this.pausedAt = 0;
    },

    isPaused: function() {
      return !!this.pausedAt;
    },

    pause: function() {
      if (this.isPaused()) return;
      this.pausedAt = getTick();
    },

    resume: function() {
      if (!this.isPaused()) return;
      this.elapsedPausedTime = this.pausedTime();
      this.pausedAt = 0;
    },

    // returns time paused in ms.
    pausedTime: function() {
      if (!this.isPaused()) return this.elapsedPausedTime;
      return this.elapsedPausedTime + (getTick() - this.pausedAt);
    },

    // returns open ticket time - paused time
    elapsedTimeV2: function() {
      var ticketTime = getTick() - this.startTime;

      var pausedTime = this.pausedTime(); // Make sure to calculate paused timer.

      if (ticketTime < pausedTime) {
        console.error(helpers.fmt('We paused more than we spent time on the ticket? Impossible! ticketTime: "%@",pausedTime: "%@"', ticketTime, this.elapsedPausedTime));
        return 0;
      }

      return Math.floor((ticketTime - pausedTime) / 1000);
    },

    commitTicketTime: function(ticketTime) {
      ticketTime = ticketTime !== undefined ? ticketTime : this.elapsedTimeV2();

      // For stay on ticket, we don't want the timer to start counting again
      // and calling resetNewTimers resets the pause state.
      var wasPaused = this.isPaused();

      // only update if ticketTime is > 0
      if (ticketTime) {
        this.ticketFieldTime(ticketTime);
        this.ticketFieldTotalTime(this.ticketFieldTotalTime() + ticketTime);
      }

      this.resetNewTimers();

      if (wasPaused) {
        this.pause();
      }
    },

    /*
     *
     * UTILS
     *
     */

    isTimelogsEnabled: function() {
      return this.ticket() && this.ticket().id() && this.setting('display_timelogs');
    },

    ticketFieldTime: function(time) {
      var fieldLabel = helpers.fmt('custom_field_%@', timeFieldId);

      if (time !== undefined) {
        return this.ticket().customField(fieldLabel, time);
      } else {
        return parseInt(this.ticket().customField(fieldLabel) || 0, 10);
      }
    },

    ticketFieldTotalTime: function(time) {
      if (this.currentLocation() === 'new_ticket_sidebar' && time === undefined) return 0;
      var fieldLabel = helpers.fmt('custom_field_%@', totalTimeFieldId);

      if (time !== undefined) {
        return this.ticket().customField(fieldLabel, time);
      } else {
        return parseInt(this.ticket().customField(fieldLabel) || 0, 10);
      }
    },

    localeForHC: function() {
      var localeString = this.currentUser().locale().toLowerCase();
      if (localeString.indexOf('pt') === 0) {
        localeString = 'pt-br';
      } else if (localeString.indexOf('en') === 0) {
        localeString = 'en-us';
      } else if (localeString.indexOf('es') === 0) {
        localeString = 'es';
      } else if (localeString.indexOf('fr') === 0) {
        localeString = 'fr';
      }
      return localeString;
    }
  };
}());
