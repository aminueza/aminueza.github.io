jQuery(document).ready(function ($) {

    /* ======= Skillset ======= */
    $('.level-bar-inner').css('width', '0');

    $(window).on('load', function () {
        $('.level-bar-inner').each(function () {
            var itemWidth = $(this).data('level');
            $(this).animate({
                width: itemWidth
            }, 800);
        });
    });

    /* Bootstrap Tooltip for Skillset */
    $('.level-label').tooltip();

    /* ======= RSS Feed Loader ======= */
    function loadRSSFeed(selector, feedUrl, limit) {
        var $container = $(selector);
        if (!$container.length) return;

        var apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feedUrl);

        $.getJSON(apiUrl)
            .done(function (data) {
                if (data.status !== 'ok' || !data.items || data.items.length === 0) {
                    $container.html('<p class="text-muted">No posts found.</p>');
                    return;
                }

                var items = data.items.slice(0, limit || 5);
                var html = '';
                $.each(items, function (i, item) {
                    var snippet = item.description || '';
                    // Strip HTML tags and truncate
                    snippet = snippet.replace(/<[^>]*>/g, '').substring(0, 200);
                    if (snippet.length >= 200) snippet += '...';

                    html += '<div class="item">';
                    html += '<h3 class="title"><a href="' + item.link + '" target="_blank" rel="noopener">' + item.title + '</a></h3>';
                    html += '<div class="post-meta"><span class="date"><i class="fa fa-calendar"></i> ' + new Date(item.pubDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '</span></div>';
                    html += '<p>' + snippet + '</p>';
                    html += '<a class="more-link" href="' + item.link + '" target="_blank" rel="noopener"><i class="fa fa-external-link"></i> Read more</a>';
                    html += '</div>';
                });

                $container.hide().html(html).slideDown('slow');
            })
            .fail(function () {
                $container.html('<p class="text-muted">Could not load posts at this time.</p>');
            });
    }

    /* Load Medium feed */
    loadRSSFeed('#rss-feeds-medium', 'https://medium.com/feed/@aminueza', 1);

    /* Load DEV.to feed */
    loadRSSFeed('#rss-feeds-devto', 'https://dev.to/feed/aminueza', 1);

    /* ======= GitHub Activity Feed ======= */
    if ($("#ghfeed").length && typeof GitHubActivity !== 'undefined') {
        GitHubActivity.feed({ username: "aminueza", selector: "#ghfeed" });
    }

    /* ======= Auto Table of Contents ======= */
    var tocContainer = document.getElementById('post-toc');
    if (tocContainer) {
        var headings = document.querySelectorAll('.post-content h2, .post-content h3');
        if (headings.length > 0) {
            var ul = document.createElement('ul');
            headings.forEach(function (h) {
                if (!h.id) return;
                var li = document.createElement('li');
                if (h.tagName === 'H3') li.style.paddingLeft = '15px';
                var a = document.createElement('a');
                a.href = '#' + h.id;
                a.textContent = h.textContent;
                li.appendChild(a);
                ul.appendChild(li);
            });
            tocContainer.appendChild(ul);
        }
    }

    /* ======= Intellectual Property Protection ======= */

    // Append copyright notice when content is copied
    document.addEventListener('copy', function (e) {
        var selection = window.getSelection().toString();
        if (selection.length > 50) {
            var copyright = '\n\n' +
                '© ' + new Date().getFullYear() + ' Amanda Souza. All rights reserved.\n' +
                'Source: ' + window.location.href + '\n' +
                'This content may not be used for AI/ML training without explicit written permission.';
            if (e.clipboardData) {
                e.clipboardData.setData('text/plain', selection + copyright);
                e.preventDefault();
            }
        }
    });

    // Prevent right-click on images to discourage casual image theft
    document.addEventListener('contextmenu', function (e) {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
        }
    });

    // Prevent drag on images
    $(document).on('dragstart', 'img', function (e) {
        e.preventDefault();
    });

});
