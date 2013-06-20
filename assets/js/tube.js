/* =========================================================
 * tube.js v0.0.1
 * =========================================================
 * Copyright 2013 (c) vasenin.com
 *
 * Youtube playlist
 * + jquery.js, underscore.js, backbone.js
 * ========================================================= */

var tube = {
    log: function (text) {
        if (typeof(window.console) !== 'undefined' && window.console.log) window.console.log(text);
    },
    parseDuration: function(duration) {
        var hours = parseInt( duration / 3600 ) % 24,
            minutes = parseInt( duration / 60 ) % 60,
            seconds = duration % 60,
            result = '';
            if( hours > 0 ) {
                result += (hours < 10 ? "0" + hours : hours) + ":";
            }
        return  result+= (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds  < 10 ? "0" + seconds : seconds);
    }
}; // Main object

(function ($) {
    _.templateSettings = {
        interpolate : /\{\{(.+?)\}\}/g
    };

    /**
     * Video Model
     * -----------
     * Keeps data about added videos
     * @type {*}
     */
    var Video = Backbone.Model.extend({
        defaults: function() {
            return {
                order: tube.playlist.getNextOrder(),
                video_id: '',
                title: '',
                thumb_url: '',
                author_name: '',
                author_username: '',
                view_count: 0,
                duration: 0

            };
        }
    });
    /**
     * Videos Collection
     * -----------------
     * Keeps data about all videos in your playlist.
     * LocalStorage is used as data storage.
     *
     * @type {*}
     */
    var Playlist = Backbone.Collection.extend({
        model: Video,
        localStorage: new Backbone.LocalStorage('vasc-backbone'),
        getNextOrder: function () {
            if (!this.length) {
                return 1;
            }
            return this.last().get('order') + 1;
        },
        // Videos are sorted by order.
        comparator: function (model) {
            return model.get('order');
        },
        next : function(model) {
            return this.at(this.indexOf(model) + 1);
        },
        prev : function(model) {
            return this.at(this.indexOf(model) - 1);
        }
    });
    tube.playlist = new Playlist();

    /**
     * Video view used in search results and playlist.
     * @type {*}
     */

    var VideoView = Backbone.View.extend({
        tagName: 'li',
        events: {
            'click img,h4': 'play',
            'click .remove': 'removeVideo',
            'click .related': 'searchRelated'
        },
        initialize: function() {
            this.listenTo(this.model, 'destroy', this.remove);
        },
        className: 'media video',
        template:_.template($('#tube-template-video').html()),
        render: function() {
            this.$el.html(this.template(this.model.toJSON()));
            this.$el.data('model', this.model);
            return this;
        },
        play: function() {
            tube.player_view.load(this.model);
            $(window).scrollTop(0);
        },
        searchRelated: function(e) {
            e.preventDefault();
            tube.search_view.$term_field.val('rel:' + this.model.get('video_id'));
            tube.search_view.search(e);
        },
        removeVideo: function(e) {
            e.preventDefault();
            this.model.destroy();
        }
    });
    var stateChange = function(state) {
        tube.player_view.stateChange(state);
    };
    /**
     * Player block where video is playing.
     * @type {*}
     */
    var PlayerView = Backbone.View.extend({
        el: '#tube-player',
        current_video: false,
        initialize: function() {
            _.bindAll(this, 'stateChange');
        },
        render: function(model) {
            this.current_video = model;
            this.player_id = 'ytapiplayer';
            this.params = { allowScriptAccess: "always" };
            this.atts = { id: this.player_id };
            window.swfobject.embedSWF("http://www.youtube.com/v/" + model.get('video_id') + "?enablejsapi=1&playerapiid=" + this.player_id + "&version=3",
                this.player_id, "640", "360", "8", null, null, this.params, this.atts);
            return this;
        },
        setup: function() {
            this.player = document.getElementById(this.player_id);
            this.player.addEventListener('onStateChange', 'youtubePlayerStateChange');
            return this;
        },
        play: function() {
            this.player.playVideo();
            return this;
        },
        load: function(video, start_seconds, quality) {
            var video_id;
            if(_.isObject(video)) {
                video_id = video.get('video_id');
                this.current_video = video;
            } else {
                this.current_video = false;
                video_id = video;
            }
            this.player.loadVideoById(video_id, (_.isUndefined(start_seconds) ? 0 : start_seconds), (_.isString(quality) ? quality : "large"));
            return this;
        },
        cue: function(video, start_seconds, quality) {
            var video_id;
            if(_.isObject(video)) {
                video_id = video.get('video_id');
                this.current_video = video;
            } else {
                this.current_video = false;
                video_id = video;
            }
            this.player.cueVideoById(video_id, (_.isUndefined(start_seconds) ? 0 : start_seconds), (_.isString(quality) ? quality : "large"));
            return this;
        },
        stateChange: function(state) {
            if(state===0 && this.current_video !== false) {
                var next_video = tube.playlist.next(this.current_video);
                if(next_video) this.load(next_video);
            }
        }
    });
    tube.player_view = new PlayerView();

    window.youtubePlayerStateChange = function(state) {
        tube.player_view.stateChange(state);
    };
    /**
     * Search form and result of search view.
     * @type {*}
     */
    var SearchView = Backbone.View.extend({
        el: '#tube-search',
        videos: {},
        current_start_index: 1,
        max_results: 25,
        $term_field: $('#tube-search-query'),
        template: _.template($('#tube-template-video-search').html()),
        events: {
            'submit #tube-search-form': 'search',
            'click .video': 'updatePlaylist'
        },
        initialize: function() {
            _.bindAll(this, 'build');
        },
        render: function() {
            this.$results = $('#tube-search-results');
            return this;
        },
        search: function(e, start_index) {
            if(_.isObject(e)) e.preventDefault();
            var query = this.$term_field.val();
            if(_.isEmpty(query)) return false;
            if(query.match(/^rel\:/)) {
                this._search_related(query.replace(/^rel\:/, ''), start_index);
            } else {
                this._search_defaults(query, start_index);
            }

        },
        _search_related: function(video_id, start_index) {
            this.current_start_index = _.isNumber(start_index) ? start_index : 1;
            var data = {
                alt: 'json',
                'start-index': this.current_start_index,
                'max-results': this.max_results
            };
            $.ajax({
                type: 'get',
                headers: {
                    'GData-Version': 2
                },
                cache: false,
                url: '//gdata.youtube.com/feeds/api/videos/' + video_id + '/related',
                data: data
            }).done(this.build);
        },
        _search_defaults: function(query, start_index) {
            this.current_start_index = _.isNumber(start_index) ? start_index : 1;
            var data = {
                    alt: 'json',
                    'start-index': this.current_start_index,
                    'max-results': this.max_results,
                    safeSearch: 'none',
                    q: query
                };
            $.ajax({
                type: 'get',
                headers: {
                    'GData-Version': 2,
                    'X-GData-Key': 'key=AI39si79XIVHZgwy4X_S0kK4R5AarJtyDZ3L6-3ehwJ9SPGAfODG8vbLt0PQ3Mr-yNH-XJq-KHJc9Kz4ReKpy79dsJ5OAdTD1g'
                },
                cache: false,
                url: '//gdata.youtube.com/feeds/api/videos',
                data: data
            }).done(this.build);
        },
        play: function(e) {
            e.preventDefault();
            e.stopPropagation();
            var video_id = $(e.currentTarget).data('video-id');
            tube.player_view.load(video_id);
        },
        updatePlaylist: function(e) {
            e.preventDefault();
            var video_id = $(e.currentTarget).data('video-id');
            tube.playlist.create(this.videos[video_id]);
        },
        build: function(data) {
            var html = '';
            this.videos = {};
            this.$results.html('<span class="loading">Loading...</span>');
            _.each(data.feed.entry, function(item){
                var id = _.last(item.id['$t'].split(/\:/));
                this.videos[id] =  {
                    video_id: id,
                    author_name: item.author[0].name['$t'],
                    author_username: _.last(item.author[0].uri['$t'].split(/\//)),
                    title: item.title['$t'],
                    view_count: (_.isObject(item['yt$statistics']) ? parseInt(item['yt$statistics'].viewCount) : 0),
                    thumb_url: item['media$group']['media$thumbnail'][0].url,
                    duration: parseInt(item['media$group']['yt$duration'].seconds)
                };
                html += this.template(this.videos[id]);
            }, this);
            this.$results.html(html);
        }
    });
    tube.search_view = new SearchView();

    /**
     * Playlist view
     * @type {*}
     */
    var PlaylistView = Backbone.View.extend({
        el: '#tube-playlist',
        video_views: []
    });
    tube.playlist_view = new PlaylistView();

    tube.search_view.render();
    tube.playlist_view.render();

    /**
     * Main view. Used as initializer of app.
     * @type {*}
     */
    var App = Backbone.View.extend({
        el: '#tube',
        initialize: function() {
            tube.playlist.on('add', this.addVideo, this);
            tube.playlist.on('reset', this.allVideo, this);
        },
        render: function() {
            tube.playlist.fetch({reset: true});
        },
        allVideo: function(models) {
            models.each(function(model){
                this.addVideo(model);
            }, this);
        },
        addVideo: function(model) {
            var view = new VideoView({model: model});
            tube.playlist_view.video_views.push(view);
            tube.playlist_view.$el.append(view.render().el);
            if(tube.playlist_view.$el.find('.video').length==1) {
                tube.player_view.render(model);
                window.setTimeout(function(){
                    window.tube.player_view.setup();
                }, 2000);
            }
            this.setSorting();
        },
        setSorting: function() {
            tube.playlist_view.$el.sortable({
                update: function(event, ui) {
                    var i = 0;
                    tube.playlist_view.$el.find('.video').each(function(){
                        var model = $(this).data('model');
                        model.save({order: i++});
                    });
                    window.tube.playlist.sort();
                }
            });
        }
    });

    tube.app = new App();
    tube.app.render();

})(window.jQuery);