function parseRecruitMessage(text) {
  const patterns = [
    {
      regex: /急招[：:]\s*(.+?)[\s,，、。；;]+剧本[：:]\s*(.+?)[\s,，、。；;]+时间[：:]\s*(.+?)[\s,，、。；;]+缺[：:]?\s*(\d+)\s*人[\s,，、。；;]*(?:角色[：:]\s*(.+))?$/i,
      fields: ['shop_name', 'script_name', 'start_time', 'need_count', 'role_requirement']
    },
    {
      regex: /^急招[\s\n]*店名[：:]\s*(.+?)[\s\n,，、。；;]*剧本[：:]\s*(.+?)[\s\n,，、。；;]*时间[：:]\s*(.+?)[\s\n,，、。；;]*缺[：:]?\s*(\d+)\s*人[\s\n,，、。；;]*(?:角色要求[：:]\s*(.+?))?$/is,
      fields: ['shop_name', 'script_name', 'start_time', 'need_count', 'role_requirement']
    },
    {
      regex: /^急招[\s\n]*([^\n]+?)[\s\n,，、。；;]+([^\n]+?)[\s\n,，、。；;]+(\d{1,2}[月\/\-\.]\d{1,2}[日号]?\s*\d{1,2}[:：]\d{2}|[今明后]天?\s*\d{1,2}[:：]\d{2}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s*\d{1,2}[:：]\d{2})[\s\n,，、。；;]+缺\s*(\d+)\s*人[\s\n,，、。；;]*(.*?)$/is,
      fields: ['shop_name', 'script_name', 'start_time', 'need_count', 'role_requirement']
    }
  ];

  for (const p of patterns) {
    const match = text.match(p.regex);
    if (match) {
      const result = {};
      p.fields.forEach((field, i) => {
        result[field] = match[i + 1] ? match[i + 1].trim() : '';
      });
      result.need_count = parseInt(result.need_count);
      result.start_time = parseTimeString(result.start_time);
      if (result.need_count > 0 && result.start_time) {
        return result;
      }
    }
  }

  return null;
}

function parseTimeString(timeStr) {
  if (!timeStr) return null;

  const now = new Date();
  const year = now.getFullYear();

  let match = timeStr.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})[日号]?\s*(\d{1,2})[:：](\d{2})/);
  if (match) {
    return new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${match[4].padStart(2, '0')}:${match[5]}:00`).toISOString();
  }

  match = timeStr.match(/(\d{1,2})[月\/\-\.](\d{1,2})[日号]?\s*(\d{1,2})[:：](\d{2})/);
  if (match) {
    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const hour = parseInt(match[3]);
    const minute = parseInt(match[4]);
    let targetYear = year;
    if (month < now.getMonth() + 1 || (month === now.getMonth() + 1 && day < now.getDate())) {
      targetYear = year + 1;
    }
    return new Date(targetYear, month - 1, day, hour, minute, 0).toISOString();
  }

  match = timeStr.match(/(今天|明天|后天)\s*(\d{1,2})[:：](\d{2})/);
  if (match) {
    const offset = { '今天': 0, '明天': 1, '后天': 2 }[match[1]];
    const target = new Date(now);
    target.setDate(target.getDate() + offset);
    target.setHours(parseInt(match[2]), parseInt(match[3]), 0, 0);
    return target.toISOString();
  }

  match = timeStr.match(/(\d{1,2})[:：](\d{2})/);
  if (match) {
    const target = new Date(now);
    target.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.toISOString();
  }

  return null;
}

function parseJoinMessage(text, nickname) {
  const normalized = text.toLowerCase().trim();

  const isUpdateCmd =
    /^(改到店|到店)/.test(normalized) ||
    /^(改备注|备注)[：:\s]+/.test(text.trim()) ||
    /^(取消上车|取消报名|不去了|鸽车|下车|退出)\s*$/i.test(text.trim());

  if (!isUpdateCmd &&
      !/(上车|报名|我来|算我|加入|我要上)/.test(normalized) &&
      !/^(男生|女生|男|女|♂|♀)/.test(normalized) &&
      !/反串/.test(normalized) &&
      !/^\d+分钟/.test(normalized) &&
      !/到店/.test(normalized) &&
      !/(候补|排队|备用)/.test(normalized)) {
    return null;
  }

  const result = {
    nickname,
    gender: '',
    can_crossplay: false,
    arrival_time: '',
    note: '',
    is_standby: false,
    action: 'join',
    updateFields: {}
  };

  if (/候补|排队|等|备用/.test(normalized)) {
    result.is_standby = true;
  }

  const genderMatch = text.match(/(男生|男生|男|♂)|(女生|女生|女|♀)/);
  if (genderMatch) {
    if (genderMatch[1]) result.gender = '男';
    else if (genderMatch[2]) result.gender = '女';
    if (result.gender) result.updateFields.gender = result.gender;
  }

  if (/反串/.test(normalized)) {
    result.can_crossplay = true;
    result.updateFields.can_crossplay = true;
    if (!result.gender) {
      if (text.includes('男生') || text.includes('男') || text.includes('♂')) result.gender = '男';
      else if (text.includes('女生') || text.includes('女') || text.includes('♀')) result.gender = '女';
      if (result.gender) result.updateFields.gender = result.gender;
    }
  }

  const arrivalMatch = text.match(/到店\s*(\d+)\s*分钟|(\d+)\s*分钟.*到店/);
  if (arrivalMatch) {
    result.arrival_time = (arrivalMatch[1] || arrivalMatch[2]) + '分钟';
    result.updateFields.arrival_time = result.arrival_time;
    result.action = 'update';
  }

  const remarkMatch = text.match(/^(改备注|备注)[：:\s]+(.{1,40})/i);
  if (remarkMatch) {
    result.note = remarkMatch[2].trim();
    result.updateFields.note = result.note;
    result.action = 'update';
  }

  if (/带.{0,3}人|带\d|\+\d/.test(normalized)) {
    const extraMatch = text.match(/带\s*(\d+)|\+\s*(\d+)/);
    const extra = extraMatch ? (parseInt(extraMatch[1] || extraMatch[2]) - 1) : 0;
    if (extra > 0) {
      result.note = `带${extra}人`;
      result.updateFields.note = result.note;
    }
  }

  return result;
}

function isAdminCommand(text) {
  return /^(锁车|解锁|取消|删除|移除)\s*#?\d*$/.test(text.trim()) ||
         /^(踢人|移除|踢)\s*@?.+$/.test(text.trim()) ||
         /^列表$/.test(text.trim()) ||
         /^(切换到|切到|切换)\s*#?\s*第?\s*\d+\s*(场|局|个)?$/.test(text.trim()) ||
         /^(取消上车|取消报名|不去了|鸽车|下车|退出)\s*$/i.test(text.trim());
}

module.exports = {
  parseRecruitMessage,
  parseJoinMessage,
  parseTimeString,
  isAdminCommand
};
