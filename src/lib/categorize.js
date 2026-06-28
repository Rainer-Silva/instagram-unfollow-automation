const businessCategoryPatterns = [
  'product/service',
  'product service',
  'shopping & retail',
  'shopping and retail',
  'retail company',
  'business service',
  'local business',
  'entrepreneur',
  'brand',
  'clothing',
  'health/beauty',
  'beauty, cosmetic & personal care',
  'real estate',
  'education',
  'consulting agency',
  'advertising/marketing',
  'marketing agency',
  'personal blog',
  'digital creator',
  'video creator',
  'creator',
  'public figure',
  'artist',
  'musician/band',
  'author',
  'coach',
  'restaurant',
  'cafe',
  'food & beverage',
  'travel company'
];

const sellingPatterns = [
  'shop',
  'store',
  'sale',
  'deals',
  'discount',
  'promo',
  'product',
  'products',
  'brand',
  'retail',
  'market',
  'boutique',
  'official',
  'business',
  'agency',
  'course',
  'coaching',
  'academy',
  'service',
  'services'
];

const publicPagePatterns = [
  'news',
  'media',
  'magazine',
  'blog',
  'travel',
  'embassy',
  'company',
  'restaurant',
  'fitness',
  'music',
  'beats',
  'club',
  'team',
  'community',
  'creator',
  'public figure',
  'artist',
  'musician',
  'author'
];

function hasAny(haystack, patterns) {
  return patterns.some((pattern) => haystack.includes(pattern));
}

function categorizeCandidate(candidate) {
  const haystack = `${candidate.username || ''} ${candidate.rowText || ''}`.toLowerCase();
  const hasMutual = /followed by|mutual|also follows|follows you/.test(haystack);

  if (hasMutual) {
    return {
      category: 'mutual_friends_last',
      priority: 90,
      reason: 'mutual-friend/follows-you text detected'
    };
  }

  if (hasAny(haystack, businessCategoryPatterns)) {
    return {
      category: 'instagram_business_or_creator_category',
      priority: 5,
      reason: 'Instagram-visible category label detected'
    };
  }

  if (hasAny(haystack, sellingPatterns)) {
    return {
      category: 'selling_or_product_page',
      priority: 10,
      reason: 'selling/product keyword detected'
    };
  }

  if (hasAny(haystack, publicPagePatterns)) {
    return {
      category: 'public_or_general_page',
      priority: 20,
      reason: 'public/general page keyword detected'
    };
  }

  return {
    category: 'person_or_uncategorized',
    priority: 50,
    reason: 'no page/selling/mutual keyword detected'
  };
}

function sortCandidatesByCategory(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.username.localeCompare(b.username);
  });
}

module.exports = { categorizeCandidate, sortCandidatesByCategory };
