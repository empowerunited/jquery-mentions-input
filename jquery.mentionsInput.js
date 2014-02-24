/*
 * Mentions Input
 * Version 1.2.0
 * Written by: Kenneth Auchenberg (Podio), Nickolay Tzvetinov - meddle0x53 (Empowerunited)
 *
 * Using underscore.js
 *
 * License: MIT License - http://www.opensource.org/licenses/mit-license.php
 */
(function ($, _, undefined) {

  // Settings
  var KEY = { BACKSPACE : 8, TAB : 9, RETURN : 13, ESC : 27, LEFT : 37, UP : 38, RIGHT : 39, DOWN : 40, COMMA : 188, SPACE : 32, HOME : 36, END : 35 }; // Keys "enum"
  var defaultSettings = {
    triggerChar   : '@',
    onDataRequest : $.noop,
    minChars      : 3,
    types         : ['user'],
    showAvatars   : true,
    elastic       : false,
    elasticError  : 20,
    classes       : {
      autoCompleteItemActive : "active"
    },
    templates     : {
      wrapper                    : _.template('<div class="mentions-input-box"></div>'),
      autocompleteList           : _.template('<div class="mentions-autocomplete-list"></div>'),
      autocompleteListItem       : _.template('<li data-ref-id="<%= id %>" data-ref-type="<%= type %>" data-display="<%= display %>"><%= content %></li>'),
      autocompleteListItemAvatar : _.template('<img src="<%= avatar %>" />'),
      autocompleteListItemIcon   : _.template('<div class="icon <%= icon %>"></div>'),
      mentionsOverlay            : _.template('<div class="mentions"><div></div></div>'),
      mentionItemSyntax          : _.template('@[<%= value %>](<%= type %>:<%= id %>)'),
      mentionItemHighlight       : _.template('<span><b data-type="<%= type%>" data-id="<%= id%>"><%= value %></b></span>')
    }
  };

  var utils = {
    htmlEncode       : function (str) {
      return _.escape(str);
    },
    highlightTerm    : function (value, term) {
      if (!term && !term.length) {
        return value;
      }
      return value.replace(new RegExp("(?![^&;]+;)(?!<[^<>]*)(" + term + ")(?![^<>]*>)(?![^&;]+;)", "gi"), "<b>$1</b>");
    },
    getAllIndecesOf:   function (value, text, caseSensitive) {
        var startIndex = 0, valueLen = value.length,
            index, indices = [];

        if (!caseSensitive) {
          text = text.toLowerCase();
          value = value.toLowerCase();
        }

        while ((index = text.indexOf(value, startIndex)) > -1) {
          indices.push(index);
          startIndex = index + valueLen;
        }

        return indices;
    },
    rtrim: function(string) {
      return string.replace(/\s+$/,"");
    }
  };

  var MentionsInput = function (settings) {

    var domInput, elmInputBox, elmInputWrapper, elmAutocompleteList, elmWrapperBox, elmMentionsOverlay, elmActiveAutoCompleteItem,
        mentionsCollection = [], mentionsMap = {};
    var autocompleteItemCollection = {};
    var inputBuffer = [];
    var currentDataQuery;
    var previousInput = '', previousCaretPosition, previousWord, caretPosition;

    settings = $.extend(true, {}, defaultSettings, settings );
    settings.mentionsRegex = settings.mentionsRegex || new RegExp("@\\[(.*?)\\]\\((" + settings.types.join('|') + "):(.*?)\\)");

    function initTextarea() {
      elmInputBox = $(domInput);

      if (elmInputBox.attr('data-mentions-input') == 'true') {
        return;
      }

      elmInputWrapper = elmInputBox.parent();
      elmWrapperBox = $(settings.templates.wrapper());
      elmInputBox.wrapAll(elmWrapperBox);
      elmWrapperBox = elmInputWrapper.find('> div');

      elmInputBox.attr('data-mentions-input', 'true');
      elmInputBox.bind('keydown', onInputBoxKeyDown);
      elmInputBox.bind('keypress', onInputBoxKeyPress);
      elmInputBox.bind('input', onInputBoxInput);
      elmInputBox.bind('click', onInputBoxClick);
      elmInputBox.bind('blur', onInputBoxBlur);
      elmInputBox.bind('elastified', onInputElastified);
      elmInputBox.bind('focus', onInputElastified);

      // Elastic textareas, internal setting for the Dispora guys
      if (settings.elastic) {
        elmInputBox.elastic();
      }
    }

    function initAutocomplete() {
      elmAutocompleteList = $(settings.templates.autocompleteList());
      elmAutocompleteList.appendTo(elmWrapperBox);
      elmAutocompleteList.delegate('li', 'mousedown', onAutoCompleteItemClick);
    }

    function initMentionsOverlay() {
      elmMentionsOverlay = $(settings.templates.mentionsOverlay());
      elmMentionsOverlay.prependTo(elmWrapperBox);
      elmMentionsOverlay.find('div').html(elmInputBox.val())
    }

    function updateValues() {
      var syntaxMessage = getInputBoxValue(),
          mention, removedMention, removedMentionPos, textParts = [], ind,
          formattedMention, textSyntax, textHighlight, match,
          nextInput, mentionText, textToReplace, removeUpdate = false;

      match = settings.mentionsRegex.exec(syntaxMessage);
      if (match !== null && match[1] && match[2] && match[3]) {
        mention = {
          value: match[1],
          name: match[1],
          type: match[2],
          id: match[3]
        };
        syntaxMessage = syntaxMessage.replace(match[0], mention.value);
        elmInputBox.val(syntaxMessage);

        mentionsCollection.push(mention);
        mentionsMap[mention.name] = (mentionsMap[mention.name] || 0) + 1;
      }

      removedMention = _.find(mentionsCollection, function (mention, index) {
        if (mentionsMap[mention.value] === 1) {
          return !mention.value || syntaxMessage.indexOf(mention.value) == -1
        } else {
          return mentionsMap[mention.value] !== (syntaxMessage.split(mention.value).length - 1);
        }
      });

      if (removedMention) {
        syntaxMessage = previousInput;

        if (mentionsMap[removedMention.value] > 1) {
          removedMentionPos = 0;
          _.each(utils.getAllIndecesOf(removedMention.value, syntaxMessage, true), function (index) {
            if (index < caretPosition) {
              removedMentionPos = removedMentionPos + 1;
            }
          });
        } else {
          removedMentionPos = 1;
        }
      }

      _.each(mentionsCollection, function (mention) {
        textSyntax = settings.templates.mentionItemSyntax(mention);
        textToReplace = mention.value;

        if (removedMention && removedMention.value == mention.value && removedMentionPos <= 1 && !removeUpdate) {
          mentionsMap[mention.value] = mentionsMap[mention.value] - 1;
          removedMention = mention;

          if (removedMention.value.indexOf(' ') > 0) {
            removedMention.value = removedMention.value.replace(previousWord, '').trim().replace(/ +(?= )/g,'');
            textSyntax = settings.templates.mentionItemSyntax(removedMention);

            mentionsMap[removedMention.value] = (mentionsMap[removedMention.value] || 0)  + 1;
          } else {
            textSyntax = '';
          }

          removeUpdate = true;
        } else if (removedMention && removedMention.value == mention.value) {
          removedMentionPos = removedMentionPos - 1;
        }

        ind = syntaxMessage.indexOf(textToReplace) + textToReplace.length;
        textParts.push(syntaxMessage.substring(0, ind).replace(textToReplace, textSyntax));

        syntaxMessage = syntaxMessage.substring(ind);
      });
      textParts.push(syntaxMessage);

      syntaxMessage = textParts.join('');

      mentionText = utils.htmlEncode(syntaxMessage);

      _.each(mentionsCollection, function (mention) {
        formattedMention = _.extend({}, mention, {value: utils.htmlEncode(mention.value)});
        textSyntax = settings.templates.mentionItemSyntax(formattedMention);
        textHighlight = settings.templates.mentionItemHighlight(formattedMention);

        mentionText = mentionText.replace(textSyntax, textHighlight);
      });

      nextInput = mentionText;
      mentionText = mentionText.replace(/\n/g, '<br />');
      mentionText = mentionText.replace(/ {2}/g, '&nbsp; ');

      elmInputBox.data('messageText', syntaxMessage);
      elmMentionsOverlay.find('div').html(mentionText);

      if (removedMention) {
        elmInputBox.val(nextInput.replace(/<(?:.|\n)*?>/gm, ''));
        elmInputBox.selectRange(previousCaretPosition);
      }

    }

    function resetBuffer() {
      inputBuffer = [];
    }

    function updateMentionsCollection() {
      var inputText = getInputBoxValue();

      mentionsCollection = _.reject(mentionsCollection, function (mention, index) {
        return !mention.value || inputText.indexOf(mention.value) == -1
      });
      mentionsCollection = _.compact(mentionsCollection);
    }

    function addMention(mention) {

      var currentMessage = getInputBoxValue();

      // Using a regex to figure out positions
      var regex = new RegExp("\\" + settings.triggerChar + currentDataQuery, "gi");
      regex.exec(currentMessage);

      var fullQuery = settings.triggerChar + currentDataQuery;
      var firstIndex = currentMessage.indexOf(fullQuery, (elmInputBox[0].selectionEnd || 0) - fullQuery.length);
      var lastIndex = firstIndex + currentDataQuery.length + 1;

      var startCaretPosition = firstIndex;
      var currentCaretPosition = lastIndex;

      var start = currentMessage.substr(0, startCaretPosition);
      var end = currentMessage.substr(currentCaretPosition, currentMessage.length);
      var startEndIndex = (start + mention.value).length + 1;

      mentionsCollection.push(mention);
      mentionsMap[mention.name] = (mentionsMap[mention.name] || 0) + 1;

      // Cleaning before inserting the value, otherwise auto-complete would be triggered with "old" inputbuffer
      resetBuffer();
      currentDataQuery = '';
      hideAutoComplete();

      // Mentions & syntax message
      var updatedMessageText = start + mention.value + ' ' + end;
      elmInputBox.val(updatedMessageText);
      updateValues();

      // Set correct focus and selection
      elmInputBox.focus();
      elmInputBox.selectRange(startEndIndex);
    }

    function getInputBoxValue() {
      return $.trim(elmInputBox.val());
    }

    function onAutoCompleteItemClick(e) {
      var elmTarget = $(this);
      var mention = autocompleteItemCollection[elmTarget.attr('data-uid')];

      addMention(mention);

      return false;
    }

    function onInputBoxClick(e) {
      resetBuffer();
    }

    function onInputBoxBlur(e) {
      hideAutoComplete();

      return true;
    }


    function getCaret() {
      var node = elmInputBox[0],
          c, sel, dul, len;

      if (node.selectionStart) {
        return node.selectionStart;
      } else if (!document.selection) {
        return 0;
      }

      c = "\001";
      sel = document.selection.createRange();
      dul = sel.duplicate();
      len = 0;

      dul.moveToElementText(node);
      sel.text = c;
      len = dul.text.indexOf(c);
      sel.moveStart('character',-1);
      sel.text = "";
      return len;
    }

    function currentWord() {
      var text = elmInputBox.val(),
          caretPos = getCaret(),
          index = text.indexOf(caretPos),
          preText = text.substring(0, caretPos),
          words;

      if (preText.indexOf(' ') > 0) {
        words = preText.split(' ');
        return words[words.length - 1];
      } else {
        return preText;
      }
    }

    function currentWholeWord() {
      var text = elmInputBox.val(),
          caretPos = getCaret(),
          index = text.indexOf(caretPos),
          preText = text.substring(0, caretPos),
          nextText = text.substring(caretPos),
          words, nextInd;

      nextInd = nextText.indexOf(' ');
      if (nextInd > 0) {
        nextText = nextText.substring(0, nextInd)
      }

      if (preText.indexOf(' ') > 0) {
        words = preText.split(' ');
        return words[words.length - 1] + nextText;
      } else {
        return preText;
      }
    }

    function beginningOfCurrentWord() {
      var text = elmInputBox.val(),
          caretPos = getCaret(),
          index = text.indexOf(caretPos),
          preText = text.substring(0, caretPos),
          prevInd = preText.lastIndexOf(' ');

      if (prevInd > 0) {
        return prevInd;
      } else {
        return preText;
      }
    }

    function onInputBoxInput(e) {
      var triggerCharIndex, wordUnderCursor;

      updateValues();
      updateMentionsCollection();

      triggerCharIndex = _.lastIndexOf(inputBuffer, settings.triggerChar);
      if (triggerCharIndex === -1) {
        wordUnderCursor = currentWord();
        triggerCharIndex = _.lastIndexOf(wordUnderCursor, settings.triggerChar);

        inputBuffer = wordUnderCursor.split('');
      }

      if (triggerCharIndex > -1) {
        currentDataQuery = inputBuffer.slice(triggerCharIndex + 1).join('');
        if (getInputBoxValue().indexOf(' ' + settings.triggerChar + currentDataQuery) !== -1 ||
           getInputBoxValue().indexOf(settings.triggerChar + currentDataQuery) === 0) {
          currentDataQuery = utils.rtrim(currentDataQuery);

          _.defer(_.bind(doSearch, this, currentDataQuery));
        }
      }
    }

    function onInputBoxKeyPress(e) {
      if(e.keyCode !== KEY.BACKSPACE) {
        var typedValue = String.fromCharCode(e.which || e.keyCode);
        inputBuffer.push(typedValue);
      }
    }

    function onInputBoxKeyDown(e) {
      previousInput = getInputBoxValue();
      previousCaretPosition = beginningOfCurrentWord();
      caretPosition = getCaret();
      previousWord = currentWholeWord();

      // This also matches HOME/END on OSX which is CMD+LEFT, CMD+RIGHT
      if (e.keyCode == KEY.LEFT || e.keyCode == KEY.RIGHT || e.keyCode == KEY.HOME || e.keyCode == KEY.END) {
        // Defer execution to ensure carat pos has changed after HOME/END keys
        _.defer(resetBuffer);

        // IE9 doesn't fire the oninput event when backspace or delete is pressed. This causes the highlighting
        // to stay on the screen whenever backspace is pressed after a highlighed word. This is simply a hack
        // to force updateValues() to fire when backspace/delete is pressed in IE9.
        if (navigator.userAgent.indexOf("MSIE 9") > -1) {
          _.defer(updateValues);
        }

        return;
      }

      if (e.keyCode == KEY.BACKSPACE) {
        inputBuffer = inputBuffer.slice(0, -1 + inputBuffer.length); // Can't use splice, not available in IE
        return;
      }

      if (!elmAutocompleteList.is(':visible')) {
        return true;
      }

      switch (e.keyCode) {
        case KEY.UP:
        case KEY.DOWN:
          var elmCurrentAutoCompleteItem = null;
          if (e.keyCode == KEY.DOWN) {
            if (elmActiveAutoCompleteItem && elmActiveAutoCompleteItem.length) {
              elmCurrentAutoCompleteItem = elmActiveAutoCompleteItem.next();
            } else {
              elmCurrentAutoCompleteItem = elmAutocompleteList.find('li').first();
            }
          } else {
            elmCurrentAutoCompleteItem = $(elmActiveAutoCompleteItem).prev();
          }

          if (elmCurrentAutoCompleteItem.length) {
            selectAutoCompleteItem(elmCurrentAutoCompleteItem);
          }

          return false;

        case KEY.RETURN:
        case KEY.TAB:
          if (elmActiveAutoCompleteItem && elmActiveAutoCompleteItem.length) {
            elmActiveAutoCompleteItem.trigger('mousedown');
            return false;
          }

          break;
      }

      return true;
    }

    function onInputElastified() {
      if (elmMentionsOverlay) {
        var newHeight = elmInputBox.height() + settings.elasticError;
        elmMentionsOverlay.height(newHeight - settings.elasticError);
        elmWrapperBox.height(newHeight);
        elmAutocompleteList.css({'top': '' + newHeight + 'px'})
      }
      return true;
    }

    function hideAutoComplete() {
      elmActiveAutoCompleteItem = null;
      elmAutocompleteList.empty().hide();

      onInputElastified();
    }

    function selectAutoCompleteItem(elmItem) {
      elmItem.addClass(settings.classes.autoCompleteItemActive);
      elmItem.siblings().removeClass(settings.classes.autoCompleteItemActive);

      elmActiveAutoCompleteItem = elmItem;
    }

    function populateDropdown(query, results) {
      elmAutocompleteList.show();

      // Filter items that has already been mentioned
      var mentionIds = _.pluck(mentionsCollection, 'id');
      results = _.reject(results, function (item) {
        return _.include(mentionIds, item.id);
      });


      if (!results.length) {
        hideAutoComplete();
        return;
      }

      elmAutocompleteList.empty();
      var elmDropDownList = $("<ul>").appendTo(elmAutocompleteList).hide();

      _.each(results, function (item, index) {
        var itemUid = _.uniqueId('mention_');

        autocompleteItemCollection[itemUid] = _.extend({}, item, {value: item.name});

        var elmListItem = $(settings.templates.autocompleteListItem({
          'id'      : utils.htmlEncode(item.id),
          'display' : utils.htmlEncode(item.name),
          'type'    : utils.htmlEncode(item.type),
          'content' : utils.highlightTerm(utils.htmlEncode((item.name)), query)
        })).attr('data-uid', itemUid);

        if (index === 0) {
          selectAutoCompleteItem(elmListItem);
        }

        if (settings.showAvatars) {
          var elmIcon;

          if (item.avatar) {
            elmIcon = $(settings.templates.autocompleteListItemAvatar({ avatar : item.avatar }));
          } else {
            elmIcon = $(settings.templates.autocompleteListItemIcon({ icon : item.icon }));
          }
          elmIcon.prependTo(elmListItem);
        }
        elmListItem = elmListItem.appendTo(elmDropDownList);
      });

      elmAutocompleteList.show();
      elmDropDownList.show();
    }

    function doSearch(query) {
      if (query && query.length && query.length >= settings.minChars) {
        settings.onDataRequest.call(this, 'search', query, function (responseData) {
          populateDropdown(query, responseData);
        });
      } else {
        hideAutoComplete();
      }
    }

    function resetInput() {
      elmInputBox.val('');
      mentionsCollection = [];
      updateValues();
    }

    // Implemented by https://github.com/jfschwarz
    function destroy() {
      if (!elmInputBox) {
        return;
      }

      elmInputBox.removeAttr('data-mentions-input');
      elmInputBox.unbind('keydown', onInputBoxKeyDown);
      elmInputBox.unbind('keypress', onInputBoxKeyPress);
      elmInputBox.unbind('input', onInputBoxInput);
      elmInputBox.unbind('click', onInputBoxClick);
      elmInputBox.unbind('blur', onInputBoxBlur);

      // unwrap the input
      elmWrapperBox = elmInputWrapper.find('> div');
      elmInputWrapper.append(elmInputBox);
      elmWrapperBox.remove();

      $.removeData(elmInputBox.get(0), 'mentionsInput');
    }

    // Public methods
    return {
      init : function (domTarget) {

        domInput = domTarget;

        initTextarea();
        initAutocomplete();
        initMentionsOverlay();
        //resetInput();

        if( settings.prefillMention ) {
          addMention( settings.prefillMention );
        }

      },

      val : function (callback) {
        if (!_.isFunction(callback)) {
          return;
        }

        var value = mentionsCollection.length ? elmInputBox.data('messageText') : getInputBoxValue();
        callback.call(this, value);
      },

      reset : function () {
        resetInput();
      },

      destroy: function() {
        destroy();
      },

      getMentions : function (obj) {
        var syntaxMessage = getInputBoxValue(), textParts = [], ind;


        _.each(mentionsCollection, function (mention) {
          var textSyntax = settings.templates.mentionItemSyntax(mention);

          ind = syntaxMessage.indexOf(mention.value) + mention.value.length;
          textParts.push(syntaxMessage.substring(0, ind).replace(mention.value, textSyntax));

          syntaxMessage = syntaxMessage.substring(ind);
        });
        textParts.push(syntaxMessage);
        syntaxMessage = textParts.join('');

        obj.mentions = mentionsCollection;
        obj.content = syntaxMessage;
      }
    };
  };

  $.fn.selectRange = function(start, end) {
    if (!end) {
      end = start;
    }

    return this.each(function() {
      if (this.setSelectionRange) {
        this.focus();
        this.setSelectionRange(start, end);
      } else if (this.createTextRange) {
        var range = this.createTextRange();

        range.collapse(true);
        range.moveEnd('character', end);
        range.moveStart('character', start);
        range.select();
      }
    });
  };

  $.fn.mentionsInput = function (method, settings) {

    var outerArguments = arguments;

    if (typeof method === 'object' || !method) {
      settings = method;
    }

    return this.each(function () {
      if ('destroy' === method && !$.data(this, 'mentionsInput')){
        return void 0;
      }
      var instance = $.data(this, 'mentionsInput') || $.data(this, 'mentionsInput', new MentionsInput(settings));

      if (_.isFunction(instance[method])) {
        return instance[method].apply(this, Array.prototype.slice.call(outerArguments, 1));

      } else if (typeof method === 'object' || !method) {
        return instance.init.call(this, this);

      } else {
        $.error('Method ' + method + ' does not exist');
      }

    });
  };

})(jQuery, _);

