/* ============================================================
 * forum-media.js — 论坛图片适配层
 * 业务数据只保存 assetId；原始图片 Blob 统一存入 MediaRepository。
 * ============================================================ */
(function (global) {
  'use strict';

  var MAX_FILES = 4;
  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 24 * 1024 * 1024;
  var ALLOWED_TYPES = {
    'image/jpeg': true,
    'image/png': true,
    'image/webp': true,
    'image/gif': true,
    'image/avif': true
  };

  function getRepository() {
    var storage = global.PhoneStorage;
    if (!storage || !storage.repository || typeof storage.repository.media !== 'function') {
      throw new Error('论坛图片仓库尚未加载，请刷新页面后重试');
    }
    return storage.repository.media(storage.result);
  }

  function normalizeFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (list.length > MAX_FILES) throw new Error('一条内容最多添加 4 张图片');
    var total = 0;
    list.forEach(function (file) {
      if (!file || !ALLOWED_TYPES[file.type]) {
        throw new Error('图片仅支持 JPG、PNG、WebP、GIF 和 AVIF 格式');
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        throw new Error('单张图片需大于 0 且不超过 8 MB');
      }
      total += file.size;
    });
    if (total > MAX_TOTAL_BYTES) throw new Error('本次图片总大小不能超过 24 MB');
    return list;
  }

  function release(assetIds, ownerType, ownerId) {
    var list = Array.isArray(assetIds) ? assetIds.slice() : [];
    if (!list.length) return Promise.resolve([]);
    var repo;
    try { repo = getRepository(); } catch (error) { return Promise.resolve([]); }
    return Promise.all(list.map(function (assetId) {
      return repo.removeRef(assetId, ownerType, ownerId).catch(function () { return null; });
    }));
  }

  function upload(files, ownerType, ownerId) {
    var list;
    try {
      list = normalizeFiles(files);
      if (!ownerType || !ownerId) throw new Error('图片归属信息缺失，请重试');
    } catch (error) {
      return Promise.reject(error);
    }
    if (!list.length) return Promise.resolve([]);
    var repo;
    try { repo = getRepository(); } catch (error) { return Promise.reject(error); }
    var assetIds = [];
    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        return repo.putBlob(file, {
          type: 'image',
          mimeType: file.type,
          ownerType: ownerType,
          ownerId: ownerId
        }).then(function (result) {
          if (!result || !result.ok || !result.value || !result.value.assetId) {
            throw new Error(result && result.error && result.error.message
              ? result.error.message : '图片保存失败');
          }
          assetIds.push(result.value.assetId);
        });
      });
    });
    return chain.then(function () {
      return assetIds;
    }).catch(function (error) {
      return release(assetIds, ownerType, ownerId).then(function () { throw error; });
    });
  }

  function markup(assetIds, extraClass) {
    var ids = (Array.isArray(assetIds) ? assetIds : []).filter(function (id) {
      return typeof id === 'string' && /^as_[A-Z2-7]{32}$/.test(id);
    }).slice(0, MAX_FILES);
    if (!ids.length) return '';
    var className = extraClass === 'comment-media' ? ' comment-media' : '';
    return '<div class="forum-media-grid' + className + '">' + ids.map(function (id, index) {
      return '<figure class="forum-media-item"><img data-forum-media-asset="' + id +
        '" alt="图片 ' + (index + 1) + '" loading="lazy" decoding="async"></figure>';
    }).join('') + '</div>';
  }

  function hydrate(root) {
    if (!root || !root.querySelectorAll) return Promise.resolve([]);
    var images = Array.prototype.slice.call(root.querySelectorAll('img[data-forum-media-asset]'));
    var repo;
    try { repo = getRepository(); } catch (error) { return Promise.resolve([]); }
    return Promise.all(images.map(function (img) {
      var assetId = img.getAttribute('data-forum-media-asset');
      return repo.toObjectUrl(assetId).then(function (result) {
        if (!result || !result.ok || !result.value || !result.value.url) {
          img.alt = '图片暂时无法读取';
          img.classList.add('media-load-failed');
          return null;
        }
        img.src = result.value.url;
        img.dataset.forumObjectUrl = result.value.url;
        img.addEventListener('error', function () {
          img.alt = '图片暂时无法显示';
        }, { once: true });
        return result.value.url;
      }).catch(function () {
        img.alt = '图片暂时无法读取';
        img.classList.add('media-load-failed');
        return null;
      });
    }));
  }

  function revokeIn(root) {
    if (!root || !root.querySelectorAll || !global.URL || !global.URL.revokeObjectURL) return;
    Array.prototype.forEach.call(root.querySelectorAll('img[data-forum-object-url]'), function (img) {
      var url = img.dataset.forumObjectUrl;
      if (url) global.URL.revokeObjectURL(url);
      delete img.dataset.forumObjectUrl;
    });
  }

  function preview(files, container) {
    if (!container) return;
    clearPreview(container);
    var list;
    try { list = normalizeFiles(files); }
    catch (error) {
      container.textContent = error.message || '图片格式不支持';
      return;
    }
    container._forumPreviewUrls = [];
    list.forEach(function (file, index) {
      var figure = document.createElement('figure');
      figure.className = 'forum-preview-item';
      var img = document.createElement('img');
      var url = global.URL.createObjectURL(file);
      container._forumPreviewUrls.push(url);
      img.src = url;
      img.alt = '待上传图片 ' + (index + 1);
      figure.appendChild(img);
      container.appendChild(figure);
    });
  }

  function clearPreview(container) {
    if (!container) return;
    (container._forumPreviewUrls || []).forEach(function (url) {
      try { global.URL.revokeObjectURL(url); } catch (error) {}
    });
    container._forumPreviewUrls = [];
    container.textContent = '';
  }

  function toDataUrls(assetIds) {
    var ids = (Array.isArray(assetIds) ? assetIds : []).filter(function (id) {
      return typeof id === 'string' && /^as_[A-Z2-7]{32}$/.test(id);
    }).slice(0, MAX_FILES);
    if (!ids.length) return Promise.resolve([]);
    var repo;
    try { repo = getRepository(); } catch (error) { return Promise.reject(error); }
    return Promise.all(ids.map(function (assetId) {
      return repo.toDataUrl(assetId).then(function (result) {
        if (!result || !result.ok || typeof result.value !== 'string' ||
            result.value.indexOf('data:image/') !== 0) {
          throw new Error('有图片暂时无法读取，AI 看图回复未发送');
        }
        return result.value;
      });
    }));
  }

  global.ForumMedia = {
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    upload: upload,
    release: release,
    markup: markup,
    hydrate: hydrate,
    revokeIn: revokeIn,
    preview: preview,
    clearPreview: clearPreview,
    toDataUrls: toDataUrls
  };

  global.addEventListener('pagehide', function () {
    revokeIn(document);
  });
})(window);
