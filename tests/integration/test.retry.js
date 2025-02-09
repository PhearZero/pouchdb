'use strict';

var adapters = [
  ['local', 'http'],
  ['http', 'http'],
  ['http', 'local'],
  ['local', 'local']
];

adapters.forEach(function (adapters) {
  var suiteName = 'test.retry.js-' + adapters[0] + '-' + adapters[1];
  describe(suiteName, function () {

    var dbs = {};

    beforeEach(function () {
      dbs.name = testUtils.adapterUrl(adapters[0], 'testdb');
      dbs.remote = testUtils.adapterUrl(adapters[1], 'test_repl_remote');
    });

    afterEach(function (done) {
      testUtils.cleanup([dbs.name, dbs.remote], done);
    });

    it('retry stuff', function (done) {
      var remote = new PouchDB(dbs.remote);
      var Promise = testUtils.Promise;
      var bulkGet = remote.bulkGet;

      // Reject attempting to write 'foo' 3 times, then let it succeed
      var i = 0;
      remote.bulkGet = function (opts) {
        if (opts.docs[0].id === 'foo') {
          if (++i !== 3) {
            return Promise.reject(new Error('flunking you'));
          }
        }
        return bulkGet.apply(remote, arguments);
      };

      var db = new PouchDB(dbs.name);
      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      });

      var paused = 0;
      rep.on('paused', function (e) {
        ++paused;
        // The first paused event is the replication up to date
        // and waiting on changes (no error)
        if (paused === 1) {
          should.not.exist(e);
          return remote.put({_id: 'foo'}).then(function () {
            return remote.put({_id: 'bar'});
          });
        }
        // Second paused event is due to failed writes, should
        // have an error
        if (paused === 2) {
          should.exist(e);
        }
      });

      var active = 0;
      rep.on('active', function () {
        ++active;
      });

      rep.on('complete', function () {
        active.should.be.at.least(2);
        paused.should.be.at.least(2);
        done();
      });

      rep.catch(done);

      var numChanges = 0;
      rep.on('change', function (c) {
        numChanges += c.docs_written;
        if (numChanges === 3) {
          rep.cancel();
        }
      });

      remote.put({_id: 'hazaa'});
    });

    it('#3687 active event only fired once...', function (done) {

      var remote = new PouchDB(dbs.remote);
      var db = new PouchDB(dbs.name);
      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      });

      var paused = 0;
      var error;
      rep.on('paused', function (e) {
        ++paused;
        // The first paused event is the replication up to date
        // and waiting on changes (no error)
        try {
          should.not.exist(e);
        } catch (err) {
          error = err;
          rep.cancel();
        }
        if (paused === 1) {
          return remote.put({_id: 'foo'});
        } else {
          rep.cancel();
        }
      });

      var active = 0;
      rep.on('active', function () {
        ++active;
      });

      var numChanges = 0;
      rep.on('change', function () {
        ++numChanges;
      });

      rep.on('complete', function () {
        try {
          active.should.be.within(1, 2);
          paused.should.equal(2);
          numChanges.should.equal(2);
          done(error);
        } catch (err) {
          done(err);
        }
      });

      rep.catch(done);

      remote.put({_id: 'hazaa'});
    });

    it('source doesn\'t leak "destroyed" event', function () {

      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      var Promise = testUtils.Promise;

      var bulkGet = remote.bulkGet;
      var i = 0;
      remote.bulkGet = function () {
        // Reject three times, every 5th time
        if ((++i % 5 === 0) && i <= 15) {
          return Promise.reject(new Error('flunking you'));
        }
        return bulkGet.apply(remote, arguments);
      };

      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      });

      var numDocsToWrite = 10;

      return remote.post({}).then(function () {
        var originalNumListeners;
        var posted = 0;

        return new Promise(function (resolve, reject) {

          var error;
          function cleanup(err) {
            if (err) {
              error = err;
            }
            rep.cancel();
          }
          function finish() {
            if (error) {
              return reject(error);
            }
            resolve();
          }

          rep.on('complete', finish).on('error', cleanup);
          rep.on('change', function () {
            if (++posted < numDocsToWrite) {
              remote.post({}).catch(cleanup);
            } else {
              db.info().then(function (info) {
                if (info.doc_count === numDocsToWrite) {
                  cleanup();
                }
              }).catch(cleanup);
            }

            try {
              var numListeners = db.listeners('destroyed').length;
              if (typeof originalNumListeners !== 'number') {
                originalNumListeners = numListeners;
              } else {
                numListeners.should.equal(originalNumListeners,
                  'numListeners should never increase');
              }
            } catch (err) {
              cleanup(err);
            }
          });
        });
      });
    });

    it('target doesn\'t leak "destroyed" event', function () {

      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      var Promise = testUtils.Promise;

      var remoteBulkGet = remote.bulkGet;
      var i = 0;
      remote.bulkGet = function () {
        // Reject three times, every 5th time
        if ((++i % 5 === 0) && i <= 15) {
          return Promise.reject(new Error('flunking you'));
        }
        return remoteBulkGet.apply(remote, arguments);
      };

      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      });

      var numDocsToWrite = 10;

      return remote.post({}).then(function () {
        var originalNumListeners;
        var posted = 0;

        return new Promise(function (resolve, reject) {

          var error;
          function cleanup(err) {
            if (err) {
              error = err;
            }
            rep.cancel();
          }
          function finish() {
            if (error) {
              return reject(error);
            }
            resolve();
          }

          rep.on('complete', finish).on('error', cleanup);
          rep.on('change', function () {
            if (++posted < numDocsToWrite) {
              remote.post({}).catch(cleanup);
            } else {
              db.info().then(function (info) {
                if (info.doc_count === numDocsToWrite) {
                  cleanup();
                }
              }).catch(cleanup);
            }

            try {
              var numListeners = remote.listeners('destroyed').length;
              if (typeof originalNumListeners !== 'number') {
                originalNumListeners = numListeners;
              } else {
                // special case for "destroy" - because there are
                // two Changes() objects for local databases,
                // there can briefly be one extra listener or one
                // fewer listener. The point of this test is to ensure
                // that the listeners don't grow out of control.
                numListeners.should.be.within(
                  originalNumListeners - 1,
                  originalNumListeners + 1,
                  'numListeners should never increase by +1/-1');
              }
            } catch (err) {
              cleanup(err);
            }
          });
        });
      });
    });

    [
      'complete', 'error', 'paused', 'active',
      'change', 'cancel'
    ].forEach(function (event) {
      it('returnValue doesn\'t leak "' + event + '" event', function () {

        var db = new PouchDB(dbs.name);
        var remote = new PouchDB(dbs.remote);
        var Promise = testUtils.Promise;

        var remoteBulkGet = remote.bulkGet;
        var i = 0;
        remote.bulkGet = function () {
          // Reject three times, every 5th time
          if ((++i % 5 === 0) && i <= 15) {
            return Promise.reject(new Error('flunking you'));
          }
          return remoteBulkGet.apply(remote, arguments);
        };

        var rep = db.replicate.from(remote, {
          live: true,
          retry: true,
          back_off_function: function () { return 0; }
        });

        var numDocsToWrite = 10;

        return remote.post({}).then(function () {
          var originalNumListeners;
          var posted = 0;

          return new Promise(function (resolve, reject) {

            var error;
            function cleanup(err) {
              if (err) {
                error = err;
              }
              rep.cancel();
            }
            function finish() {
              if (error) {
                return reject(error);
              }
              resolve();
            }

            rep.on('complete', finish).on('error', cleanup);
            rep.on('change', function () {
              if (++posted < numDocsToWrite) {
                remote.post({}).catch(cleanup);
              } else {
                db.info().then(function (info) {
                  if (info.doc_count === numDocsToWrite) {
                    cleanup();
                  }
                }).catch(cleanup);
              }

              try {
                var numListeners = rep.listeners(event).length;
                if (typeof originalNumListeners !== 'number') {
                  originalNumListeners = numListeners;
                } else {
                  if (event === "paused") {
                    Math.abs(numListeners -  originalNumListeners).should.be.at.most(1);
                  } else {
                    Math.abs(numListeners -  originalNumListeners).should.be.eql(0);
                  }
                }
              } catch (err) {
                cleanup(err);
              }
            });
          });
        });
      });
    });

    it('returnValue doesn\'t leak "change" event w/ onChange', function () {

      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      var Promise = testUtils.Promise;

      var remoteBulkGet = remote.bulkGet;
      var i = 0;
      remote.bulkGet = function () {
        // Reject three times, every 5th time
        if ((++i % 5 === 0) && i <= 15) {
          return Promise.reject(new Error('flunking you'));
        }
        return remoteBulkGet.apply(remote, arguments);
      };

      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      }).on('change', function () {});

      var numDocsToWrite = 10;

      return remote.post({}).then(function () {
        var originalNumListeners;
        var posted = 0;

        return new Promise(function (resolve, reject) {

          var error;
          function cleanup(err) {
            if (err) {
              error = err;
            }
            rep.cancel();
          }
          function finish() {
            if (error) {
              return reject(error);
            }
            resolve();
          }

          rep.on('complete', finish).on('error', cleanup);
          rep.on('change', function () {
            if (++posted < numDocsToWrite) {
              remote.post({}).catch(cleanup);
            } else {
              db.info().then(function (info) {
                if (info.doc_count === numDocsToWrite) {
                  cleanup();
                }
              }).catch(cleanup);
            }

            try {
              var numListeners = rep.listeners('change').length;
              if (typeof originalNumListeners !== 'number') {
                originalNumListeners = numListeners;
              } else {
                numListeners.should.equal(originalNumListeners,
                  'numListeners should never increase');
              }
            } catch (err) {
              cleanup(err);
            }
          });
        });
      });
    });

    it('retry many times, no leaks on any events', function () {
      this.timeout(200000);
      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      var Promise = testUtils.Promise;

      var flunked = 0;
      var remoteBulkGet = remote.bulkGet;
      var i = 0;
      remote.bulkGet = function () {
        // Reject five times, every 5th time
        if ((++i % 5 === 0) && i <= 25) {
          flunked++;
          return Promise.reject(new Error('flunking you'));
        }
        return remoteBulkGet.apply(remote, arguments);
      };

      var rep = db.replicate.from(remote, {
        live: true,
        retry: true,
        back_off_function: function () { return 0; }
      });

      var active = 0;
      var paused = 0;
      var numDocsToWrite = 50;

      return remote.post({}).then(function () {
        var originalNumListeners;
        var posted = 0;

        return new Promise(function (resolve, reject) {

          var error;
          function cleanup(err) {
            if (err) {
              error = err;
            }
            rep.cancel();
          }
          function finish() {
            if (error) {
              return reject(error);
            }
            resolve();
          }
          function getTotalListeners() {
            var events = ['complete', 'error', 'paused', 'active',
              'change', 'cancel'];
            return events.map(function (event) {
              return rep.listeners(event).length;
            }).reduce(function (a, b) {return a + b; }, 0);
          }

          rep.on('complete', finish)
            .on('error', cleanup)
            .on('active', function () {
            active++;
          }).on('paused', function () {
            paused++;
          }).on('change', function () {
            if (++posted < numDocsToWrite) {
              remote.post({}).catch(cleanup);
            } else {
              db.info().then(function (info) {
                if (info.doc_count === numDocsToWrite) {
                  cleanup();
                }
              }).catch(cleanup);
            }

            try {
              var numListeners = getTotalListeners();
              if (typeof originalNumListeners !== 'number') {
                originalNumListeners = numListeners;
              } else {
                Math.abs(numListeners -  originalNumListeners).should.be.at.most(1);
              }
            } catch (err) {
              cleanup(err);
            }
          });
        });
      }).then(function () {
        flunked.should.equal(5);
        active.should.be.at.least(5);
        paused.should.be.at.least(5);
      });
    });


    it('4049 retry while starting offline', function (done) {

      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);

      var ajax = remote._ajax;
      var _called = 0;
      var startFailing = false;

      remote._ajax = function (opts, cb) {
        if (!startFailing || ++_called > 3) {
          ajax.apply(this, arguments);
        } else {
          cb(new Error('flunking you'));
        }
      };

      remote.post({a: 'doc'}).then(function () {
        startFailing = true;
        var rep = db.replicate.from(remote, {live: true, retry: true})
          .on('change', function () { rep.cancel(); });

        rep.on('complete', function () {
          remote._ajax = ajax;
          done();
        });
      });

    });

    it('#5157 replicate many docs with live+retry', function () {
      if (testUtils.isIE()) {
        return Promise.resolve();
      }
      var numDocs = 512; // uneven number
      var docs = [];
      for (var i = 0; i < numDocs; i++) {
        // mix of generation-1 and generation-2 docs
        if (i % 2 === 0) {
          docs.push({
            _id: testUtils.uuid(),
            _rev: '1-x',
            _revisions: { start: 1, ids: ['x'] }
          });
        } else {
          docs.push({
            _id: testUtils.uuid(),
            _rev: '2-x',
            _revisions: { start: 2, ids: ['x', 'y'] }
          });
        }
      }
      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      return db.bulkDocs({
        docs: docs,
        new_edits: false
      }).then(function () {
        function replicatePromise(fromDB, toDB) {
          return new Promise(function (resolve, reject) {
            var replication = fromDB.replicate.to(toDB, {
              live: true,
              retry: true,
              batches_limit: 10,
              batch_size: 20
            }).on('paused', function (err) {
              if (!err) {
                replication.cancel();
              }
            }).on('complete', resolve)
              .on('error', reject);
          });
        }
        return Promise.all([
          replicatePromise(db, remote),
          replicatePromise(remote, db)
        ]);
      }).then(function () {
        return remote.info();
      }).then(function (info) {
        info.doc_count.should.equal(numDocs);
      });
    });

    it('6510 no changes live+retry does not call backoff function', function () {
      var Promise = testUtils.Promise;
      var db = new PouchDB(dbs.name);
      var remote = new PouchDB(dbs.remote);
      var called = false;
      var replication;

      function replicatePromise(fromDB, toDB) {
        return new Promise(function (resolve, reject) {
           replication = fromDB.replicate.to(toDB, {
            live: true,
            retry: true,
            heartbeat: 5,
            back_off_function: function () {
              called = true;
              replication.cancel();
            }
          }).on('complete', resolve)
            .on('error', reject);
        });
      }

      setTimeout(function () {
        if (replication) {
          replication.cancel();
        }
      }, 2000);

      return replicatePromise(remote, db)
      .then(function () {
        called.should.equal(false);
      });
    });

  });
});
