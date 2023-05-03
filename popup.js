// Copyright (c) 2012,2013 Peter Coles - http://mrcoles.com/ - All rights reserved.
// Use of this source code is governed by the MIT License found in LICENSE


//
// console object for debugging
//

var log = (function() {
    var parElt = document.getElementById('wrap'),
        logElt = document.createElement('div');
    logElt.id = 'log';
    logElt.style.display = 'block';
    parElt.appendChild(logElt);

    return function() {
        var a, p, results = [];
        for (var i=0, len=arguments.length; i<len; i++) {
            a = arguments[i];
            try {
                a = JSON.stringify(a, null, 2);
            } catch(e) {}
            results.push(a);
        }
        p = document.createElement('p');
        p.innerText = results.join(' ');
        p.innerHTML = p.innerHTML.replace(/ /g, '&nbsp;');
        logElt.appendChild(p);
    };
})();


//
// utility methods
//

function $(id) { return document.getElementById(id); }
function show(id) { $(id).style.display = 'block'; }
function hide(id) { $(id).style.display = 'none'; }


//
// URL Matching test - to verify we can talk to this URL
//

var matches = ['http://*/*', 'https://*/*', 'ftp://*/*', 'file://*/*'],
    noMatches = [/^https?:\/\/chrome.google.com\/.*$/];

function testURLMatches(url) {
    // couldn't find a better way to tell if executeScript
    // wouldn't work -- so just testing against known urls
    // for now...
    var r, i;
    for (i=noMatches.length-1; i>=0; i--) {
        if (noMatches[i].test(url)) {
            return false;
        }
    }
    for (i=matches.length-1; i>=0; i--) {
        r = new RegExp('^' + matches[i].replace(/\*/g, '.*') + '$');
        if (r.test(url)) {
            return true;
        }
    }
    return false;
}


//
// Events
//

var screenshot, contentURL = '';

function sendScrollMessage(tab) {
    contentURL = tab.url;
    screenshot = {};
    chrome.tabs.sendMessage(tab.id, {msg: 'scrollPage'}, function() {
        // We're done taking snapshots of all parts of the window. Display
        // the resulting full screenshot image in a new browser tab.
        openPage();
    });
}

function sendLogMessage(data) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {msg: 'logMessage', data: data}, function() {});
    });
}

chrome.runtime.onMessage.addListener(function(request, sender, callback) {
    if (request.msg === 'capturePage') {
        capturePage(request, sender, callback);
        return true;
    } else {
        console.error('Unknown message received from content script: ' + request.msg);
        return false;
    }
});

function capturePage(data, sender, callback) {
    $('bar').style.width = parseInt(data.complete * 100, 10) + '%';

    chrome.tabs.captureVisibleTab(
        null, {format: 'png', quality: 100}, function(dataURI) {
            if (dataURI) {
                var image = new Image();
                image.onload = function() {
                    data.image = {width: image.width, height: image.height};

                    // given device mode emulation or zooming, we may end up with
                    // a different sized image than expected, so let's adjust to
                    // match it!
                    if (data.windowWidth !== image.width) {
                        var scale = image.width / data.windowWidth;
                        data.x *= scale;
                        data.y *= scale;
                        data.totalWidth *= scale;
                        data.totalHeight *= scale;
                    }

                    // lazy initialization of canvas (since we need to wait
                    // for actual image size)
                    if (!screenshot.canvas) {
                        var canvas = document.createElement('canvas');
                        canvas.width = data.totalWidth;
                        canvas.height = data.totalHeight;
                        screenshot.canvas = canvas;
                        screenshot.ctx = canvas.getContext('2d');
                    }

                    // draw it
                    screenshot.ctx.drawImage(image, data.x, data.y);

                    // send back log data for debugging (but keep it truthy to
                    // indicate success)
                    callback(JSON.stringify(data, null, 4) || true);
                };
                image.src = dataURI;
            }
        });
}

function openPage() {
    // standard dataURI can be too big, let's blob instead
    // http://code.google.com/p/chromium/issues/detail?id=69227#c27

    var dataURI = screenshot.canvas.toDataURL();

    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs
    var byteString = atob(dataURI.split(',')[1]);

    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

    // write the bytes of the string to an ArrayBuffer
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    // create a blob for writing to a file
    var blob = new Blob([ab], {type: mimeString});

    // come up with file-system size with a little buffer
    var size = blob.size + (1024/2);

    // come up with a filename
    var name = contentURL.split('?')[0].split('#')[0];
    if (name) {
        name = name
            .replace(/^https?:\/\//, '')
            .replace(/[^A-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[_\-]+/, '')
            .replace(/[_\-]+$/, '');
        name = '-' + name;
    } else {
        name = '';
    }
    name = 'screencapture' + name + '-' + Date.now() + '.png';

    function onwriteend() {
        // open the file that now contains the blob
        window.open('filesystem:chrome-extension://' + chrome.i18n.getMessage('@@extension_id') + '/temporary/' + name);
    }

    function errorHandler() {
        show('uh-oh');
    }

    // create a blob for writing to a file
    window.webkitRequestFileSystem(window.TEMPORARY, size, function(fs){
        fs.root.getFile(name, {create: true}, function(fileEntry) {
            fileEntry.createWriter(function(fileWriter) {
                fileWriter.onwriteend = onwriteend;
                fileWriter.write(blob);
            }, errorHandler);
        }, errorHandler);
    }, errorHandler);
}


//
// start doing stuff immediately! - including error cases
//

chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (testURLMatches(tab.url)) {
        var loaded = false;

        chrome.tabs.executeScript(tab.id, {file: 'page.js'}, function() {
            loaded = true;
            show('loading');
            sendScrollMessage(tab);
        });

        window.setTimeout(function() {
            if (!loaded) {
                show('uh-oh');
            }
        }, 1000);
    } else {
        show('invalid');
    }
});
