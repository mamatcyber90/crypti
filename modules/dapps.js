/**
 * @author Crypti
 * @copyright © Crypti 2015.
 * @module Module.Dapps
 */
var Router = require('../helpers/router.js');
var http = require('http');
var url = require('url');
var path = require('path');
var fs = require('fs');
var Download = require('download');
var underscore  = require('underscore');
var async = require('async');
var dblite = require('dblite');
var squel = require('squel');

module.exports = Dapps;

var modules, library, self, dbLite;

function Dapps(cb, scope) {
    self = this;
    library = scope;
    dbLite = scope.dbLite;

    attachApi();

    setImmediate(cb, null, self);
}

function attachApi() {
    var router = new Router();

    router.get('/', function(req, res, next){
        req.sanitize('query', {
            id : 'int!'
        }, function(err, report, query){
            if (err) return next(err);
            if (! report.isValid) return res.json({success: false, error: report.issues});

            self.getDapp(query.id, function(err, dapp){
                if (err) return next(err);

                res.json({success:true, dapp:dapp});
            });
        });
    });

    router.post('/', function(req, res, next){
        req.sanitize("body", {
            name : {
                required : true,
                string : true,
                maxLength : 16,
                minLength : 1
            },
            description : {
                default : '',
                string : true,
                maxLength : 140
            },
            url : {
                required : true,
                url : {
                    protocol : ["http:", "https:"],
                    hostname : "github.com",
                    pathname : /^([^/]+\/)+[^/]+$/
                }
            },
            tags : {
                empty : true,
                array : true,
                maxLength : 10
            }
        }, function(err, report, body){
            if (err) return next(err);
            if (! report.isValid) return res.json({success:false, error: report.issues});

            self.addDapp(body, function(err, dapp){
                if (err) return next(err);

                res.json({succes:true, dapp:dapp});
            });
        });
    });

    router.delete('/', function(req, res, next){
        req.sanitize("query", {
            id : "int!"
        }, function(err, report, query){
            if (err) return next(err);
            if (! report.isValid) return res.json({success:false, error: report.issues});

            self.removeDapp(query.id, function(err){
                if (err) return next(err);

                res.json({success:true});
            });
        });
    });

    router.get('/fetch', function(req, res, next){
        self.getDapp(req.query.id, function(err, dapp){
            if (err) return next(err);
            if (! dapp) return res.status(404).json({success:false});

            self.fetchDapp(dapp, function(err, files){
                if (err) return next(err);

                res.json({success:true, files   :files});
            });
        });
    });

    router.get('/list', function(req, res, next){
        req.sanitize("query", {
            size : {
                default : 25,
                int : true
            },
            page : {
                default : 1,
                int : true
            },
            order : {
                empty : true,
                string : true
            }
        }, function(err, report, query){
            if (err) return next(err);
            if (! report.isValid) return res.json({success: false, error: report.issues});


            self.getDapps({
                limit: query.size,
                offset: (query.page - 1) * query.size,
                order: query.order
            }, function(err, list){
                if (err) return next(err);

                res.json({success: true, items: list});
            });
        });
    });

    router.get('/search', function(req, res, next){
        req.sanitize("query", {
            q : {
                string : true
            },
            size : {
                default : 25,
                int : true
            },
            page : {
                default : 1,
                int : true
            },
            order : {
                empty : true,
                string : true
            }
        }, function(err, report, query){
            if (err) return next(err);
            if (! report.isValid) return res.json({success: false, error: report.issues});


            var options = {
                limit: query.size,
                offset: (query.page - 1) * query.size,
                order: query.order
            };

            if (query.q) {
                self.searchDapps(query.q, options, function(err, list){
                    if (err) return next(err);

                    res.json({success: true, items: list});
                });
            } else {
                self.getDapps(options, function(err, list){
                    if (err) return next(err);

                    res.json({success: true, items: list});
                });
            }
        });
    });

    router.get('/tags/:tag', function(req, res, next){
        var tag = self.normalizeTag(req.params.tag);
        if (! tag) return res.json({success: true, items : []});

        self.getDappsByTagValue(tag, function(err, dapps){
            if (err) return next(err);

            res.json({success: true, items: dapps});
        });
    });

    router.get('/tags', function(req, res, next){
        req.sanitize("query", {
            tags : {
                empty : true,
                array : ","
            }
        }, function(err, report, query){
            if (err) return next(err);
            if (! report.isValid) return res.json({success: false, error: report.issues});

            var tags = query.tags;

            if (! tags || ! tags.length) {
                // TODO Or send all apps?
                self.getTagsRefsGrouppedByTagIds(function(err, tags){
                    if (err) return next(err);

                    res.json({success: true, items : tags});
                });
                return;
            }

            tags = tags.map(self.normalizeTag);

            function onDapps(err, dapps) {
                if (err) return next(err);

                res.json({success: true, items: dapps});
            }

            if (tags.length == 1) {
                self.getDappsByTagValue(tags[0], onDapps);
            } else {
                self.getDappsByTagsValues(tags, onDapps);
            }
        });
    });


    library.app.use('/api/dapps/', router);
    library.app.use(function (err, req, res, next) {
        if (!err) return next();

        library.logger.error('/api/dapps', err);
        res.status(500).send({success: false, error: err});
    });
}

var dappFields = {
    id: Number,
    name: String,
    description: String,
    url: String
};

/**
 * Get dapp by id.
 * @param {number} id Dapp id.
 * @param {function(Error|null,{}|null=)} cb Result callback.
 */
Dapps.prototype.getDapp = function(id, cb) {
    library.dbLite.query('SELECT id, name, description, url FROM dapps WHERE id = $id;', {id:id}, dbappFields, function(err, rows){
        if (err) return cb(err);
        cb(null, rows[0] || null);
    });
};

/**
 * Get dapps by list of ids.
 * @param {number[]} ids Dapps ids
 * @param {{}} options Options
 * @param {function} cb Result callback
 */
Dapps.prototype.getDapps = function(ids, options, cb) {
    var defaultOptions = {order:'name'};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        arguments[0] = null;
    }

    var query = squel.select().from('dapps');

    if (ids) {
        query.where('id in ?', ids);
    }

    squelQuery(query, options, dappFields, function(err, dapps){
        if (err) return cb(err);
        if (! dapps) return cb(null, []);

        self.populateTags(dapps, cb);
    });
};

/**
 * Search dapps by query in name and description.
 * @param {string} search Search value
 * @param {{}} options List query options
 * @param {function} cb result callback
 */
Dapps.prototype.searchDapps = function(search, options, cb) {
    var defaultOptions = {order:'name'};
    if (arguments.length === 2) {
        cb = arguments[1];
        options = defaultOptions;
    }

    var query = squel.select().from('dapps');
    var expr = squel.expr();

    // Split search term on words
    search.split(/\s+/).forEach(function(term){
        term = '%' + term + '%';
        expr.and_begin()
            .or('name LIKE ?', term)
            .or('description LIKE ?', term)
            .end();
    });

    query.where(expr);

    squelQuery(query, options, dappFields, function(err, dapps){
        if (err) return cb(err);
        if (! dapps) return cb(null, []);

        self.populateTags(dapps, cb);
    });
};

/**
 * Get dapps by tag value.
 * @param {string} tag Tag value
 * @param {function} cb Result callback
 */
Dapps.prototype.getDappsByTagValue = function(tag, cb) {
    self.getTagByValue(tag, function(err, tag){
        if (err) return cb(err);
        if (! tag) return cb(null, []);

        self.getTagsRefsByTagId(tag.id, function(err, refs){
            if (err) return cb(err);
            if (! refs.length) return cb(null, []);

            var dappsIds = underscore.pluck(refs, "dappId");
            self.getDapps(dappsIds, function(err, dapps){
                if (err) return cb(err);
                if (! dapps.length) return callback(null, []);

                self.populateTags(dapps, cb);
            });
        });
    });
};

/**
 * Get dapps by tags values.
 * @param {string[]} tags Tags values
 * @param {function(Error|null,{}[]|null=)} cb Result callback.
 */
Dapps.prototype.getDappsByTagsValues = function(tags, cb) {
    this.getTagsByValue(tags, function(err, tags){
        if (err) return cb(err);

        var tagIds = underscore.pluck(tags, "id");

        self.getTagsRefsGrouppedByDappId(tagIds, function(err, refs){
            if (err) return cb(err);


            var dappsIds = underscore.pluck(refs, "dappId");
            self.getDapps(dappsIds, function(err, dapps){
                if (err) return cb(err);

                self.populateTags(dapps, cb);
            });
        });
    });
};

/**
 * Add new Dapp to blockchain.
 * @param {{name:string,description:string,url:string}} dapp Dapp values object.
 * @param cb Result callback
 */
Dapps.prototype.addDapp = function(dapp, cb){
    dbLite.query('INSERT INTO dapps(name, description, url) VALUES(?,?,?);', [dapp.name, dapp.description, dapp.url], function(err){
        if (err) return cb(err);

        dbLite.lastRowID('dapps', function(id){
            dapp.id = id;

            dapp.tags = dapp.tags || [];
            if (! dapp.tags.length) return cb(null, dapp);

            var tags = dapp.tags.map(self.normalizeTag).filter(function(tag){
                return tag.length > 0;
            });

            tags = underscore.unique(tags);

            self.addUniqueTags(tags, function(err, tags){
                if (err) return cb(err);

                self.addTagsRefs(dapp.id, underscore.pluck(tags, 'id'), cb);
            });
        });
    });
};

/**
 * Remove dapp by id.
 * @param {number} id Dapp id
 * @param {function(Error|null)} cb Result callback
 */
Dapps.prototype.removeDapp = function(id, options, cb) {
    var defaultOptions = {limit:1};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (typeof arguments[0] !== 'object') {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        arguments[0] = null;
    }

    var query = squel.delete().from('dapps');

    if (id) {
        query.where('id = ?', id);
    }

    squelQuery(query, options, function(err) {
        console.log('REMOVE');
        cb(err);
    });
};

/**
 * Populate tags for given Dapps objects.
 * @param {{}[]} dapps Array of dapps objects
 * @param {function} cb result callback
 */
Dapps.prototype.populateTags = function(dapps, cb) {
    var ids = underscore.pluck(dapps, "id");
    var dappsIndex = underscore.indexBy(dapps, "id");
    dapps.forEach(function(dapp){
        dapp.tags = [];
    });

    self.getTagsRefsByDappId(ids, function(err, refs){
        if (err) return cb(err);

        var tags = underscore.pluck(refs, "tagId");
        tags = underscore.unique(tags);

        self.getTags(tags, function(err, tags){
            if (err) return cb(err);

            var tagsIndex = underscore.indexBy(tags, "id");

            refs.forEach(function(ref){
                dappsIndex[ref.dappId].tags.push(tagsIndex[ref.tagId].value);
            });

            cb(null, dapps);
        });
    });
};

/**
 * Fetch dapp source from repository url.
 * @param {object} dapp Dapp object
 * @param {function} cb Result callback
 */
Dapps.prototype.fetchDapp = function(dapp, cb) {
    var dappPath = path.join(path.resolve(process.cwd(), library.config.dappsDir), dapp.id);
    var gitUrl = url.parse(dapp.url);
    var repoName = gitUrl.pathname.replace(/^\/+|\/+$/,'').split('/').pop();
    var branch = gitUrl.hash || 'master';

    gitUrl.pathname += '/archive/' + branch + '.zip';
    gitUrl.hash = null;

    // TODO Download with `http.request`, unzip with `unzip` package and then `glob` dir.
    var download = new Download({extract:true})
        .get(url.format(gitUrl), dappPath);

    download.run(function(err, files){
        if (err) return cb(err);

        var packageJson = _.find(files, function(file){
            return file.relative === repoName + '-' + branch + '/package.json';
        });

        if (! packageJson) return cb(new Error('Repository package.json file not found'));

        // TODO Parse packageJson content.
        cb(null, files);
    });
};

var tagsFields = {
    id : Number,
    value : String
};

var tagsRefsFields = {
    tagId : Number,
    dappId : Number
};

/**
 * Get tags list. If tag not found create it.
 * @param {string[]} tags Tags list
 * @param {function} cb Result callback
 */
Dapps.prototype.addUniqueTags = function(tags, cb) {
    this.getTagsByValue(tags, function(err, rows){
        if (err) return cb(err);

        var exists = underscore.indexBy(rows, "value");

        tags = tags.filter(function(tag){
            return tag in exists === false;
        });

        // TODO(decide) use single query.
        async.map(tags, function(tag, done){
            dbLite.query('INSERT INTO tags(value) VALUES (?);', [tag], function(err){
                if (err) return done(err);

                done(null, tag);
            });
        }, function(err, tags){
            if (err) return cb(err);

            self.getTagsByValue(tags, function(err, tags){
                if (err) return cb(err);

                cb(null, rows.concat(tags));
            });
        });
    });
};

/**
 * Get tags by list of IDs.
 * @param {number[]} ids Tag id list
 * @param {{}=} options Query options
 * @param {function} cb result callback
 */
Dapps.prototype.getTags = function(ids, options, cb) {
    var defaultOptions = {};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        arguments[0] = null;
    }

    var query = squel.select().from('tags');

    if (ids) {
        query.where('id in ?', ids);
    }

    squelQuery(query, options, tagsFields, cb);
};

/**
 * Get tag by it's value.
 * @param {string} tag tagname
 * @param {function} cb Result callback
 */
Dapps.prototype.getTagByValue = function(tag, cb) {
    dbLite.query('SELECT id, value FROM tags WHERE value = ? LIMIT 1;', [tag], tagsFields, function(err, rows){
        if (err) return cb(err);

        cb(null, rows.length ? rows[0] : null);
    });
};

/**
 * Get tags by values list.
 * @param {string[]} tags Tags values list
 * @param {{}=} options Query options
 * @param {function} cb Result callback
 */
Dapps.prototype.getTagsByValue = function(tags, options, cb) {
    var defaultOptions = {};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        tags = null;
    }

    var query = squel.select().from('tags');

    if (tags) {
        query.where('value in ?', tags);
    }

    squelQuery(query, options, tagsFields, cb);
};

/**
 * Add tag refs for dapp.
 * @param {number} dappId Dapp id
 * @param {string[]} tags Tag values list
 * @param {function} cb Result callback
 */
Dapps.prototype.addTagsRefs = function(dappId, tags, cb){
    if (! tags.length) return setImmediate(cb, null);

    var insert = tags.map(function(tagId){
        return '(' + dblite.escape(Number(dappId)) + ',' + dblite.escape(Number(tagId)) + ')';
    }).join();

    dbLite.query('INSERT INTO tags_refs(dappId, tagId) VALUES ' + insert + ';', cb);
};

/**
 * Get tags refs by tag id.
 * @param {number} tagId tag id
 * @param {function} cb Result callback
 */
Dapps.prototype.getTagsRefsByTagId = function(tagId, cb){
    dbLite.query('SELECT tagId, dappId FROM tags_refs WHERE tagId = ?;', [tagId], tagsRefsFields, cb);
};

/**
 * Get Dapp's tags references for exact Dapp.
 * @param {number} dappId Dapp id
 * @param {{}=} options Query options
 * @param {function} cb Result callback
 */
Dapps.prototype.getTagsRefsByDappId = function(dappId, options, cb){
    var defaultOptions = {};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        argument[0] = null;
    }

    var query = squel
        .select()
        .from('tags_refs');

    if (dappId) {
        query.where('dappId in ?', dappId);
    }

    squelQuery(query, options, tagsRefsFields, cb);
};

/**
 * Get tags refs grouuped by tags ids. Result is list of tags usage.
 * @param {number[]} tagIds tags ids
 * @param {{}=} options Query options
 * @param {function} cb result callback
 */
Dapps.prototype.getTagsRefsGrouppedByTagIds = function(tagIds, options, cb) {
    var defaultOptions = {order:'-counter'};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        tagIds = null;
    }

    var query = squel
        .select()
        .field('tagId')
        .field('COUNT(tagId)', 'counter')
        .from('tags_refs')
        .group('tagId')
        ;

    if (tagIds) {
        query.where('tagId in ?', tagIds);
    }

    squelQuery(query, options, {tagId:Number, count:Number}, cb);
};

/**
 * Get tags refs groupped by Dapp ID. Returns list of dapps with counter of matched tags.
 * @param {number[]} tagIds Tags ids array
 * @param {{}=} options Query options
 * @param {function} cb Result callback
 */
Dapps.prototype.getTagsRefsGrouppedByDappId = function(tagIds, options, cb) {
    var defaultOptions = {order:'-counter'};
    if (arguments.length === 2) {
        cb = arguments[1];

        if (Array.isArray(arguments[0])) {
            options = defaultOptions;
        } else {
            options = arguments[0];
            arguments[0] = null;
        }
    } else if (arguments.length === 1) {
        cb = arguments[0];
        options = defaultOptions;
        tagIds = null;
    }



    var query = squel
        .select()
        .field('dappId')
        .field('COUNT(dappId)', 'counter')
        .from('tags_refs')
        .where('tagId IN ?', tagIds)
        .group('dappId');

    squelQuery(query, options, {dappId: Number, count:Number}, cb);
};

/**
 * Normalize Dapp tag: remove trailing space, make lowercase, replace spaces with hypes, replace nonlatin and nondigit
 * chars.
 * @param {string} tag Tag name to normalize
 * @returns {string} Normalized tag.
 * @example
 *  dapps.normalizeTag('Hello this is tag!'); // -> hello-this-is-tag
 */
Dapps.prototype.normalizeTag = function(tag) {
    return tag.toLowerCase().replace(/^\s+|\s+$/g, '').replace(/\s/,'-').replace(/[^a-z0-9-]/, '');
};

/**
 * Send query to sqlite with Squel query.
 * @param {{}} query Squel query instance
 * @param {{}=} options Query options object
 * @param {string[]|{}=}fields Fields object for `dblite` module. **Note!** Neccessary only for select query.
 * @param {function} cb Result callback
 */
function squelQuery(query, options, fields, cb) {
    if (arguments.length === 2) {
        cb = options;
        fields = null;
        options = {};
    } else if (arguments.length === 3) {
        cb = fields;
        fields = null;
    }

    if (options.order) {
        function setStringOrder(field) {
            if (field[0] === '-') {
                query.order(field.slice(1), false);
            } else {
                query.order(field);
            }
        }

        if (Array.isArray(options.order)){
            options.order.forEach(setStringOrder);
        } else if (typeof options.order === "object") {
            Object.keys(options.order).forEach(function(field){
                query.order(field, options.order[field] > 0);
            });
        } else {
            options.order.split(/\s*,\s*|\s+/).forEach(setStringOrder);
        }
    }

    if (typeof options.limit === "number") {
        query.limit(options.limit);
    }

    if (typeof options.offset === "number") {
        query.offset(options.offset);
    }

    var params = query.toParam();

    if (query instanceof squel.cls.Select) {
        dbLite.query(params.text, params.values, fields, cb);
    } else {
        dbLite.query(params.text, params.values, cb);
    }

}