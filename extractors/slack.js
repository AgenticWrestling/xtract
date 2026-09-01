// Slack-specific extractor for xtract
// Parses Slack's virtual message list DOM into clean markdown

window.xtractExtractors = window.xtractExtractors || {};

// state is an optional object { lastSenderName } that callers can pass and mutate
// across calls to preserve sender context when extracting one item at a time.
window.xtractExtractors['slack.com'] = function extractSlackMessages(root, state) {
  const messageItems = root.querySelectorAll('[data-feat="message"].c-virtual_list__item');
  if (messageItems.length === 0) return null;

  const channelTitleEl = document.querySelector('.p-view_header__channel_title');
  const channelName = channelTitleEl ? channelTitleEl.textContent.trim() : '';

  const lines = [];
  if (channelName && !state) lines.push(`# #${channelName}\n`);

  // Use caller-supplied state for cross-call continuity, or a local one for single-shot calls
  const ctx = state || { lastSenderName: '' };

  messageItems.forEach(item => {
    const senderEl = item.querySelector('[data-qa="message_sender_name"]');
    const timestamp = item.querySelector('.c-timestamp__label');
    const messageText = item.querySelector('[data-qa="message-text"]');

    if (!senderEl && !messageText) return;

    // Continuation messages (compact layout) omit the sender element — reuse last known sender
    const senderName = senderEl ? senderEl.textContent.trim() : ctx.lastSenderName;
    if (senderEl) ctx.lastSenderName = senderName;

    const timeLabel = timestamp ? timestamp.textContent.trim() : '';

    lines.push(`**${senderName}** ${timeLabel}`);

    if (messageText) {
      const md = slackNodeToMarkdown(messageText).trim();
      if (md) lines.push(md);
    }

    // Forwarded / referenced message attachments
    const attachments = item.querySelectorAll('.c-message_attachment');
    attachments.forEach(att => {
      const attAuthorEl = att.querySelector('strong[data-qa="member_name"]');
      const attTextEl = att.querySelector('[data-qa="message_attachment_slack_msg_text"]');
      const attFooterEl = att.querySelector('[data-qa="message_attachment_footer_text"]');
      const attTitleEl = att.querySelector('[data-qa="message_attachment_title_link"]');

      const attParts = [];
      if (attAuthorEl) attParts.push(`**${attAuthorEl.textContent.trim()}**`);
      if (attTextEl) {
        const md = slackNodeToMarkdown(attTextEl).trim();
        if (md) attParts.push(md);
      }
      if (attTitleEl) {
        const href = attTitleEl.getAttribute('href') || '';
        const title = attTitleEl.textContent.trim();
        attParts.push(`[${title}](${href})`);
      }
      if (attFooterEl) {
        const footerLink = attFooterEl.querySelector('a');
        if (footerLink) attParts.push(`*${footerLink.textContent.trim()}*`);
      }

      if (attParts.length > 0) {
        lines.push(attParts.map(l => `> ${l}`).join('\n>\n> '));
      }
    });

    // Reactions
    const reactions = item.querySelectorAll('button[data-qa="reactji"]');
    if (reactions.length > 0) {
      const parts = [];
      reactions.forEach(r => {
        const label = r.getAttribute('aria-label') || '';
        const m = label.match(/^(\d+) reactions?, react with (.+) emoji/);
        if (m) parts.push(`${m[2].replace(/\s+/g, '_')}: ${m[1]}`);
      });
      if (parts.length > 0) lines.push(`*Reactions: ${parts.join(' · ')}*`);
    }

    lines.push('\n---\n');
  });

  return lines.join('\n');
};

function slackNodeToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();

  if (node.hasAttribute('hidden')) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';
  if (node.getAttribute('data-stringify-ignore') === 'true') return '';

  // Show more button
  if (node.classList.contains('c-rich_text_expand_button')) return '';

  // Inline code
  if (tag === 'code') return `\`${node.textContent}\``;

  // Bold
  if (tag === 'b' || tag === 'strong') return `**${slackChildrenToMarkdown(node)}**`;

  // Italic
  if (tag === 'i' || tag === 'em') return `*${slackChildrenToMarkdown(node)}*`;

  // Mentions (@here, @channel, user mentions)
  if (node.classList.contains('c-mrkdwn__broadcast')) {
    return node.getAttribute('data-stringify-text') || node.textContent;
  }
  if (node.getAttribute('data-stringify-type') === 'mention') {
    return node.getAttribute('data-stringify-label') || node.textContent;
  }

  // Links
  if (tag === 'a') {
    if (node.getAttribute('data-stringify-type') === 'mention') {
      return node.getAttribute('data-stringify-label') || node.textContent;
    }
    const text = slackChildrenToMarkdown(node).trim();
    const href = node.getAttribute('href') || '';
    if (!text) return href;
    if (text === href) return href;
    return `[${text}](${href})`;
  }

  // Emoji image
  if (tag === 'img' && node.classList.contains('c-emoji')) {
    return node.getAttribute('alt') || '';
  }

  // Line break
  if (tag === 'br') return '\n';

  // Paragraph break span
  if (node.classList.contains('c-mrkdwn__br')) return '\n\n';

  // Unordered / ordered list
  if (node.classList.contains('p-rich_text_list')) {
    const isOrdered = node.getAttribute('data-stringify-type') === 'ordered-list';
    const items = Array.from(node.querySelectorAll(':scope > li'));
    return items.map((li, i) => {
      const prefix = isOrdered ? `${i + 1}. ` : '- ';
      return prefix + slackChildrenToMarkdown(li).trim();
    }).join('\n') + '\n';
  }

  if (tag === 'li') return slackChildrenToMarkdown(node);

  return slackChildrenToMarkdown(node);
}

function slackChildrenToMarkdown(node) {
  return Array.from(node.childNodes).map(slackNodeToMarkdown).join('');
}
